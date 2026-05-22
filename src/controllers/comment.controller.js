const prisma = require('../config/db');

exports.addComment = async (req, res) => {
  try {
    const { id } = req.params; // taskId
    const { text } = req.body;

    const task = await prisma.task.findUnique({ 
      where: { id },
      include: { 
        assignee: { select: { id: true, name: true, telegramId: true } },
        project: { select: { name: true, workspaceId: true } }
      }
    });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const comment = await prisma.comment.create({
      data: {
        text,
        taskId: id,
        authorId: req.user.id
      },
      include: { author: { select: { id: true, name: true, profilePic: true } } }
    });

    req.io.to(`project:${task.projectId}`).emit('comment:added', { taskId: id, comment });

    // Fire Telegram Notifications to relevant team stakeholders
    const recipientIds = new Set();
    const notifications = [];

    // 1. Notify the Task Assignee (if someone else commented)
    if (task.assignee && task.assignee.telegramId && task.assignee.id !== req.user.id) {
      recipientIds.add(task.assignee.id);
      notifications.push({ name: task.assignee.name, telegramId: task.assignee.telegramId });
    }

    // 2. Notify the Author's Team Leader (if someone else commented)
    const authorDetail = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { teamLeader: true }
    });
    if (authorDetail && authorDetail.teamLeader && authorDetail.teamLeader.telegramId && authorDetail.teamLeader.id !== req.user.id) {
      if (!recipientIds.has(authorDetail.teamLeader.id)) {
        recipientIds.add(authorDetail.teamLeader.id);
        notifications.push({ name: authorDetail.teamLeader.name, telegramId: authorDetail.teamLeader.telegramId });
      }
    }

    // 3. Notify Workspace Admins (if someone else commented)
    if (task.project?.workspaceId) {
      const admins = await prisma.workspaceMember.findMany({
        where: {
          workspaceId: task.project.workspaceId,
          role: 'ADMIN',
          userId: { not: req.user.id }
        },
        include: { user: { select: { id: true, name: true, telegramId: true } } }
      });

      for (const adminMember of admins) {
        const admin = adminMember.user;
        if (admin && admin.telegramId && !recipientIds.has(admin.id)) {
          recipientIds.add(admin.id);
          notifications.push({ name: admin.name, telegramId: admin.telegramId });
        }
      }
    }

    // Dispatch messages
    if (notifications.length > 0) {
      try {
        const sendTelegram = require('../services/telegram');
        const baseUrl = process.env.FRONTEND_URL || 'http://192.168.0.51:5173';
        const message = `💬 <b>NEW COMMENT ADDED</b>\n\n📌 <b>Task:</b> <code>[${task.taskKey}]</code> <b>${task.title}</b>\n📁 <b>Project:</b> <code>${task.project?.name || 'Project'}</code>\n✍️ <b>Commented By:</b> <code>${comment.author.name}</code>\n\n💬 <b>Comment Content:</b>\n<blockquote><i>"${text}"</i></blockquote>\n\n🔗 <a href="${baseUrl}/board/${task.projectId}"><b>Open Kanban Board</b></a>`;
        
        for (const recipient of notifications) {
          sendTelegram(message, recipient.telegramId);
        }
      } catch (err) {
        console.error('Comment Telegram notification error:', err);
      }
    }

    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { id } = req.params;
    const comment = await prisma.comment.findUnique({ where: { id } });
    
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    if (comment.authorId !== req.user.id && req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Can only delete your own comments' });
    }

    await prisma.comment.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
