const prisma = require('../config/db');

// Get all tasks assigned to the current user (across all projects)
exports.getMyAssignedTasks = async (req, res) => {
  try {
    let tasks = await prisma.task.findMany({
      where: { assigneeId: req.user.id },
      include: {
        assignee: {
          select: {
            id: true, name: true, profilePic: true, designation: true,
            teamLeader: { select: { name: true } }
          }
        },
        project: {
          select: {
            id: true, name: true, key: true,
            members: {
              include: { user: { select: { id: true, name: true, globalRole: true, teamLeaderId: true, designation: true, profilePic: true } } }
            }
          }
        },
        comments: { select: { id: true } },
        attachments: { select: { id: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (req.user.globalRole === 'TEAM_LEADER') {
      const userActivities = await prisma.activity.findMany({
        where: {
          text: { endsWith: `created by ${req.user.name}` }
        }
      });

      const createdTaskKeys = new Set();
      for (const act of userActivities) {
        const match = act.text.match(/Task (.*?) created by/);
        if (match && match[1]) {
          createdTaskKeys.add(match[1]);
        }
      }

      tasks = tasks.filter(t => !createdTaskKeys.has(t.taskKey));
    }

    res.json(tasks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // Check permissions
    const membership = await prisma.projectMember.findFirst({
      where: { projectId, userId: req.user.id }
    });

    let whereClause = { projectId };

    // If user is not ADMIN and not a TEAM_LEADER (in this project or globally)
    // they should only see tasks assigned to them.
    // If they ARE a TEAM_LEADER, they should see their tasks + their team members' tasks.
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTeamLeader = req.user.globalRole === 'TEAM_LEADER';

    if (!isAdmin) {
      if (isTeamLeader) {
        // First, find all team members with same designation
        const myTeamMembers = await prisma.user.findMany({
          where: {
            globalRole: 'MEMBER',
            OR: [
              { teamLeaderId: req.user.id },
              { AND: [{ teamLeaderId: null }, { designation: req.user.designation }] }
            ]
          },
          select: { id: true }
        });
        const allowedIds = [req.user.id, ...myTeamMembers.map(m => m.id)];

        // Team Leaders see ONLY tasks assigned to themselves or their own team members
        whereClause.assigneeId = { in: allowedIds };
      } else {
        // Regular members only see tasks assigned to them
        whereClause.assigneeId = req.user.id;
      }
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        assignee: {
          select: {
            id: true, name: true, profilePic: true, designation: true,
            teamLeader: { select: { name: true } }
          }
        },
        comments: { select: { id: true } },
        attachments: { select: { id: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createTask = async (req, res) => {
  try {
    const { projectId, title, description, priority, assigneeId, estHours, dueDate, startTime } = req.body;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const taskCount = await prisma.task.count({ where: { projectId } });
    const taskKey = `${project.key}-${taskCount + 1}`;

    // Check project member permissions
    const membership = await prisma.projectMember.findFirst({
      where: { projectId, userId: req.user.id }
    });

    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const canCreate = isAdmin || isTL || (req.user.globalRole === 'MEMBER' && membership) || membership?.canCreateTask;

    if (!canCreate) {
      return res.status(403).json({ error: 'You do not have permission to create tasks in this project.' });
    }

    let finalAssigneeId = assigneeId;
    if (req.user.globalRole === 'MEMBER') {
      finalAssigneeId = req.user.id;
    }

    const task = await prisma.$transaction(async (tx) => {
      // Security: If creator is Team Leader, they can only assign to self or their team
      if (isTL && finalAssigneeId && !isAdmin) {
        const targetUser = await tx.user.findUnique({ where: { id: finalAssigneeId } });
        if (targetUser && targetUser.id !== req.user.id) {
          if (targetUser.globalRole !== 'MEMBER') {
            throw new Error('You can only assign tasks to your own squad members.');
          }
          const isOwnSquad = targetUser.teamLeaderId === req.user.id || (targetUser.teamLeaderId == null && targetUser.designation === req.user.designation);
          if (!isOwnSquad) {
            throw new Error('You can only assign tasks to your own squad members.');
          }
        }
      }

      // Security: If creator is Member, they can only assign to themselves
      if (req.user.globalRole === 'MEMBER') {
        if (finalAssigneeId !== req.user.id) {
          throw new Error('You can only assign tasks to yourself.');
        }
      }

      const newTask = await tx.task.create({
        data: {
          taskKey,
          title,
          description,
          priority,
          projectId,
          assigneeId: finalAssigneeId,
          estHours: estHours ? parseFloat(estHours) : null,
          dueDate: dueDate ? new Date(dueDate) : null,
          createdAt: startTime ? new Date(startTime) : new Date()
        },
        include: {
          assignee: { select: { id: true, name: true, profilePic: true, designation: true, telegramId: true, teamLeader: { select: { name: true } } } },
          project: { select: { id: true, name: true } }
        }
      });

      await tx.activity.create({
        data: {
          text: `Task ${taskKey} created by ${req.user.name}`,
          level: 'project',
          projectId
        }
      });

      return newTask;
    });

    req.io.to(`project:${projectId}`).emit('task:created', task);

    // Fire Telegram Notification
    if (task.assignee && task.assignee.telegramId) {
      try {
        const sendTelegram = require('../services/telegram');
        const estStr = task.estHours ? `${task.estHours} hrs` : 'Not specified';
        const dueStr = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date';
        const descStr = task.description ? task.description : 'No description provided.';
        const baseUrl = process.env.FRONTEND_URL || 'http://192.168.0.51:5173';

        const message = `🔔 <b>NEW TASK ASSIGNED</b>\n\n📌 <b>Task:</b> <code>[${task.taskKey}]</code> <b>${task.title}</b>\n📁 <b>Project:</b> <code>${task.project?.name || 'N/A'}</code>\n🔥 <b>Priority:</b> <code>${task.priority}</code>\n⏱️ <b>Estimate:</b> <code>${estStr}</code>\n📅 <b>Due Date:</b> <code>${dueStr}</code>\n👤 <b>Assigned By:</b> <code>${req.user.name}</code>\n\n📝 <b>Description:</b>\n<blockquote>${descStr}</blockquote>\n\n🔗 <a href="${baseUrl}/board/${task.projectId}"><b>Open Kanban Board</b></a>`;

        sendTelegram(message, task.assignee.telegramId);
      } catch (err) {
        console.error('Telegram notification error:', err);
      }
    }

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getTask = async (req, res) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, name: true, profilePic: true } },
        comments: { include: { author: { select: { id: true, name: true, profilePic: true } } }, orderBy: { createdAt: 'desc' } },
        timeLogs: { include: { user: { select: { id: true, name: true } } }, orderBy: { loggedAt: 'desc' } },
        attachments: true
      }
    });

    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { title, description, priority, dueDate, estHours, startTime } = req.body;
    const taskToUpdate = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!taskToUpdate) return res.status(404).json({ error: 'Task not found' });

    // Check project member permissions
    const membership = await prisma.projectMember.findFirst({
      where: { projectId: taskToUpdate.projectId, userId: req.user.id }
    });

    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const canEdit = isAdmin || isTL || membership?.canEditTask;

    if (!canEdit) {
      return res.status(403).json({ error: 'You do not have permission to edit this task.' });
    }

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        title,
        description,
        priority,
        dueDate: dueDate ? new Date(dueDate) : null,
        estHours: estHours ? parseFloat(estHours) : null,
        createdAt: startTime ? new Date(startTime) : undefined
      },
      include: { assignee: { select: { id: true, name: true, profilePic: true, designation: true, teamLeader: { select: { name: true } } } } }
    });

    await prisma.activity.create({
      data: { text: `Task ${task.taskKey} updated by ${req.user.name}`, level: 'task', projectId: task.projectId }
    });

    req.io.to(`project:${task.projectId}`).emit('task:updated', task);
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const taskToDelete = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!taskToDelete) return res.status(404).json({ error: 'Task not found' });

    // Check project member permissions
    const membership = await prisma.projectMember.findFirst({
      where: { projectId: taskToDelete.projectId, userId: req.user.id }
    });

    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const canDelete = isAdmin || membership?.canDeleteTask;

    if (!canDelete) {
      return res.status(403).json({ error: 'You do not have permission to delete tasks.' });
    }

    const task = await prisma.task.delete({ where: { id: req.params.id } });
    req.io.to(`project:${task.projectId}`).emit('task:deleted', { taskId: task.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateTaskStatus = async (req, res) => {
  try {
    const { status, stuckReason } = req.body;
    const taskToUpdate = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!taskToUpdate) return res.status(404).json({ error: 'Task not found' });

    // Permission check: ADMIN, TL, or Assignee
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const isAssignee = taskToUpdate.assigneeId === req.user.id;

    if (!isAdmin && !isTL && !isAssignee) {
      return res.status(403).json({ error: 'You can only move tasks assigned to you.' });
    }

    let dataUpdate = {
      status,
      stuckReason: status === 'STUCK' ? stuckReason : null // Clear reason if no longer stuck
    };

    // Auto-Timer Logic
    if (status === 'PROGRESS') {
      // Transitioned to PROGRESS: set startTime if we were not already in PROGRESS
      if (taskToUpdate.status !== 'PROGRESS') {
        dataUpdate.startTime = new Date();
      }
      dataUpdate.endTime = null;
    } else {
      // Transitioning away from PROGRESS (to TODO, STUCK, HOLD, REVIEW, DONE):
      // If timer was running (startTime exists and endTime doesn't)
      if (taskToUpdate.startTime && !taskToUpdate.endTime) {
        const endTimeVal = new Date();

        // Calculate duration in hours
        const diffMs = endTimeVal.getTime() - new Date(taskToUpdate.startTime).getTime();
        let hoursVal = diffMs / (1000 * 60 * 60);
        if (hoursVal < 0.01) hoursVal = 0.01;
        const roundedHours = parseFloat(hoursVal.toFixed(2));

        // Auto-create TimeLog
        let note = `Auto-logged: Work stopped (Status: ${status})`;
        if (status === 'DONE') {
          note = `Auto-logged: Task completed (marked Done)`;
        } else if (status === 'REVIEW') {
          note = `Auto-logged: Work paused (submitted to Review)`;
        }

        await prisma.timeLog.create({
          data: {
            hours: roundedHours,
            note,
            taskId: taskToUpdate.id,
            userId: req.user.id
          }
        });
      }

      // Reset timer timestamps for further cycles unless status is DONE
      if (status === 'DONE') {
        dataUpdate.endTime = new Date();
      } else {
        dataUpdate.startTime = null;
        dataUpdate.endTime = null;
      }
    }

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: dataUpdate
    });

    const activityText = status === 'STUCK'
      ? `Task ${task.taskKey} moved to STUCK by ${req.user.name}. Reason: ${stuckReason || 'No reason provided'}`
      : `Task ${task.taskKey} moved to ${status} by ${req.user.name}`;

    await prisma.activity.create({
      data: { text: activityText, level: 'project', projectId: task.projectId }
    });

    req.io.to(`project:${task.projectId}`).emit('task:status_changed', { taskId: task.id, newStatus: status });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.assignTask = async (req, res) => {
  try {
    const { assigneeId } = req.body;

    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Validate assignee is ProjectMember
    if (assigneeId) {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId: task.projectId, userId: assigneeId }
      });
      if (!isMember) return res.status(400).json({ error: 'Assignee is not a member of this project' });
    }

    // Security: If assigner is Team Leader, they can only assign to self or their team
    const membership = await prisma.projectMember.findFirst({
      where: { projectId: task.projectId, userId: req.user.id }
    });

    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';
    const canAssign = isAdmin || isTL || membership?.canAssignTask;

    if (!canAssign) {
      return res.status(403).json({ error: 'You do not have permission to assign tasks.' });
    }

    if (isTL && assigneeId && !isAdmin) {
      const targetUser = await prisma.user.findUnique({ where: { id: assigneeId } });
      if (targetUser && targetUser.id !== req.user.id && (targetUser.globalRole !== 'MEMBER' || targetUser.designation !== req.user.designation)) {
        return res.status(403).json({ error: 'You can only assign tasks to your own squad members.' });
      }
    }

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id },
      data: { assigneeId },
      include: {
        assignee: { select: { id: true, name: true, profilePic: true, designation: true, telegramId: true, teamLeader: { select: { name: true } } } },
        project: { select: { id: true, name: true } }
      }
    });

    await prisma.activity.create({
      data: { text: `Task ${task.taskKey} assigned to ${updatedTask.assignee ? updatedTask.assignee.name : 'Unassigned'}`, level: 'task', projectId: task.projectId }
    });

    req.io.to(`project:${task.projectId}`).emit('task:updated', updatedTask);

    // Fire Telegram Notification
    if (updatedTask.assignee && updatedTask.assignee.telegramId) {
      try {
        const sendTelegram = require('../services/telegram');
        const estStr = updatedTask.estHours ? `${updatedTask.estHours} hrs` : 'Not specified';
        const dueStr = updatedTask.dueDate ? new Date(updatedTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date';
        const descStr = updatedTask.description ? updatedTask.description : 'No description provided.';
        const baseUrl = process.env.FRONTEND_URL || 'http://192.168.0.51:5173';

        const message = `🔔 <b>NEW TASK ASSIGNED</b>\n\n📌 <b>Task:</b> <code>[${updatedTask.taskKey}]</code> <b>${updatedTask.title}</b>\n📁 <b>Project:</b> <code>${updatedTask.project?.name || 'N/A'}</code>\n🔥 <b>Priority:</b> <code>${updatedTask.priority}</code>\n⏱️ <b>Estimate:</b> <code>${estStr}</code>\n📅 <b>Due Date:</b> <code>${dueStr}</code>\n👤 <b>Assigned By:</b> <code>${req.user.name}</code>\n\n📝 <b>Description:</b>\n<blockquote>${descStr}</blockquote>\n\n🔗 <a href="${baseUrl}/board/${updatedTask.projectId}"><b>Open Kanban Board</b></a>`;

        sendTelegram(message, updatedTask.assignee.telegramId);
      } catch (err) {
        console.error('Telegram notification error:', err);
      }
    }

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.uploadAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const attachments = await Promise.all(req.files.map(file => {
      return prisma.attachment.create({
        data: {
          filename: file.originalname,
          url: `/uploads/${file.filename}`,
          taskId: id
        }
      });
    }));

    // Fire Telegram Notification
    try {
      const task = await prisma.task.findUnique({
        where: { id },
        include: {
          assignee: { select: { id: true, name: true, telegramId: true } },
          project: { select: { name: true } }
        }
      });

      if (task && task.assignee && task.assignee.telegramId && task.assignee.id !== req.user.id) {
        const sendTelegram = require('../services/telegram');
        const filesStr = req.files.map(f => `📄 <i>${f.originalname}</i>`).join('\n');
        const baseUrl = process.env.FRONTEND_URL || 'http://192.168.0.51:5173';

        const message = `📎 <b>NEW ATTACHMENT UPLOADED</b>\n\n📌 <b>Task:</b> <code>[${task.taskKey}]</code> <b>${task.title}</b>\n📁 <b>Project:</b> <code>${task.project?.name || 'Project'}</code>\n✍️ <b>Uploaded By:</b> <code>${req.user.name}</code>\n\n📁 <b>Uploaded Files:</b>\n<blockquote>${filesStr}</blockquote>\n\n🔗 <a href="${baseUrl}/board/${task.projectId}"><b>Open Kanban Board</b></a>`;

        sendTelegram(message, task.assignee.telegramId);
      }
    } catch (telegramErr) {
      console.error('Error sending upload telegram notification:', telegramErr);
    }

    res.status(201).json(attachments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteAttachment = async (req, res) => {
  try {
    const { id, attachmentId } = req.params;

    // Optional: verify the attachment belongs to the task
    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, taskId: id }
    });

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    await prisma.attachment.delete({
      where: { id: attachmentId }
    });

    res.json({ success: true, message: 'Attachment deleted successfully' });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.stopTimerFromTelegram = async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await prisma.task.findUnique({ where: { id: taskId } });

    if (!task) return res.status(404).send('Task not found');

    // Only stop if currently in PROGRESS
    if (task.status !== 'PROGRESS') {
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; margin-top: 50px; background: #f8fafc;">
            <h2 style="color: #475569;">Task is not running!</h2>
            <p>This task is currently in <b>${task.status}</b> status.</p>
          </body>
        </html>
      `);
    }

    if (task.startTime && !task.endTime) {
      const endTimeVal = new Date();

      const diffMs = endTimeVal.getTime() - new Date(task.startTime).getTime();
      let hoursVal = diffMs / (1000 * 60 * 60);
      if (hoursVal < 0.01) hoursVal = 0.01;
      const roundedHours = parseFloat(hoursVal.toFixed(2));

      let note = `Auto-logged: Stopped directly from Telegram reminder`;

      await prisma.timeLog.create({
        data: {
          hours: roundedHours,
          note,
          taskId: task.id,
          userId: task.assigneeId
        }
      });
    }

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'TODO',
        startTime: null,
        endTime: null
      }
    });

    if (req.io) {
      req.io.to(`project:${task.projectId}`).emit('task:updated', updatedTask);
    }

    res.send(`
      <html>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px; background: #f0fdf4; color: #166534; padding: 20px;">
          <h1 style="font-size: 2rem; margin-bottom: 10px;">✅ Timer Stopped!</h1>
          <p style="font-size: 1.1rem;">Task <b>${task.title}</b> has been paused and your hours were logged.</p>
          <p style="color: #4b5563; margin-top: 20px;">You can close this window now.</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Error stopping timer from telegram:', error);
    res.status(500).send('Server Error');
  }
};
