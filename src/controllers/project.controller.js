const prisma = require('../config/db');

const notifyProjectsUpdated = (io, userIds, projectId) => {
  if (!io || !userIds?.length) return;
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  uniqueIds.forEach((userId) => {
    io.to(`user:${userId}`).emit('projects:updated', { projectId });
  });
};

exports.createProject = async (req, res) => {
  try {
    const { name, key, workspaceId, memberIds = [] } = req.body;

    // Check if user has access to workspace AND has correct role (Only Admin can create)
    const isAllowedRole = req.user.globalRole === 'ADMIN';
    if (!isAllowedRole) {
      return res.status(403).json({ error: 'Only admins can create projects' });
    }

    const isMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: req.user.id }
    });
    if (!isMember) return res.status(403).json({ error: 'Access denied to workspace' });

    const project = await prisma.$transaction(async (tx) => {
      const proj = await tx.project.create({
        data: { name, key, workspaceId }
      });

      // Add creator
      await tx.projectMember.create({
        data: {
          projectId: proj.id,
          userId: req.user.id,
          canCreateTask: true,
          canAssignTask: true,
          canEditTask: true,
          canDeleteTask: true
        }
      });

      // Add selected members (avoid duplicates)
      const otherMembers = memberIds.filter(id => id !== req.user.id);

      // Fetch users to check their global roles
      const users = await tx.user.findMany({
        where: { id: { in: otherMembers } }
      });

      for (const member of users) {
        await tx.projectMember.create({
          data: {
            projectId: proj.id,
            userId: member.id,
            canCreateTask: ['ADMIN', 'TEAM_LEADER'].includes(member.globalRole),
            canAssignTask: ['ADMIN', 'TEAM_LEADER'].includes(member.globalRole),
            canEditTask: true,
            canDeleteTask: false
          }
        });
      }

      await tx.activity.create({
        data: {
          text: `Project ${name} created by ${req.user.name}`,
          level: 'workspace',
          projectId: proj.id
        }
      });

      return proj;
    });

    const addedMemberIds = (memberIds || []).filter((id) => id !== req.user.id);
    notifyProjectsUpdated(req.io, addedMemberIds, project.id);

    res.status(201).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProject = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is member
    if (req.user.globalRole !== 'ADMIN') {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId: id, userId: req.user.id }
      });
      if (!isMember) return res.status(403).json({ error: 'Access denied' });
    }

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, globalRole: true, teamLeaderId: true, designation: true, profilePic: true } } } }
      }
    });

    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.addMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;

    // Check permission - Only ADMIN or Team Leader in project
    const myMembership = await prisma.projectMember.findFirst({
      where: { projectId: id, userId: req.user.id }
    });
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTL = req.user.globalRole === 'TEAM_LEADER';

    if (!isAdmin && !isTL) {
      return res.status(403).json({ error: 'Only admins and team leaders can add members to projects' });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } }
    });

    const results = [];
    for (const user of users) {
      // Avoid duplicate members
      const existing = await prisma.projectMember.findFirst({
        where: { projectId: id, userId: user.id }
      });
      if (existing) continue;

      const member = await prisma.projectMember.create({
        data: {
          projectId: id,
          userId: user.id,
          canCreateTask: ['ADMIN', 'TEAM_LEADER'].includes(user.globalRole),
          canAssignTask: ['ADMIN', 'TEAM_LEADER'].includes(user.globalRole),
          canEditTask: true,
          canDeleteTask: false
        }
      });
      results.push(member);
    }

    const addedUserIds = results.map((m) => m.userId);
    notifyProjectsUpdated(req.io, addedUserIds, id);

    res.status(201).json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};


exports.updateMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { canCreateTask, canAssignTask, canEditTask, canDeleteTask } = req.body;

    if (req.user.globalRole !== 'ADMIN') return res.status(403).json({ error: 'Access denied' });

    const member = await prisma.projectMember.findFirst({
      where: { projectId: id, userId }
    });

    if (!member) return res.status(404).json({ error: 'Member not found' });

    const updated = await prisma.projectMember.update({
      where: { id: member.id },
      data: { canCreateTask, canAssignTask, canEditTask, canDeleteTask }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.removeMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    
    const isAdmin = req.user.globalRole === 'ADMIN';
    const isTeamLeader = req.user.globalRole === 'TEAM_LEADER';

    // Check if the member exists in the project
    const projectMember = await prisma.projectMember.findFirst({
      where: { projectId: id, userId }
    });

    if (!projectMember) return res.status(404).json({ error: 'Member not found in project' });

    // Permission Check
    if (!isAdmin) {
      if (!isTeamLeader) {
        return res.status(403).json({ error: 'Only admins and team leaders can remove members' });
      }

      // If Team Leader, they can only remove members who report to them or share their designation
      const targetUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!targetUser || (targetUser.teamLeaderId !== req.user.id && targetUser.designation !== req.user.designation)) {
        return res.status(403).json({ error: 'You can only remove members from your own team' });
      }
    }

    await prisma.projectMember.delete({ where: { id: projectMember.id } });
    notifyProjectsUpdated(req.io, [userId], id);
    res.json({ success: true, message: 'Member removed from project' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminSecret } = req.body;

    if (req.user.globalRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can delete projects' });
    }

    if (adminSecret !== 'Meta123') {
      return res.status(403).json({ error: 'Invalid Secret Code. Project deletion failed.' });
    }

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await prisma.$transaction([
      prisma.timeLog.deleteMany({ where: { task: { projectId: id } } }),
      prisma.attachment.deleteMany({ where: { task: { projectId: id } } }),
      prisma.comment.deleteMany({ where: { task: { projectId: id } } }),
      prisma.task.deleteMany({ where: { projectId: id } }),
      prisma.projectMember.deleteMany({ where: { projectId: id } }),
      prisma.activity.deleteMany({ where: { projectId: id } }),
      prisma.project.delete({ where: { id } })
    ]);

    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
