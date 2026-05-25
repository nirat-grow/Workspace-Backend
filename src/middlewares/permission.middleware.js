const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const checkPermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (req.user.globalRole === 'ADMIN') {
        return next();
      }

      // Project ID can be in params, query, or body
      let projectId = req.params.projectId || req.query.projectId || req.body.projectId;

      // If it's a task route like /api/tasks/:id, we need to fetch the task to find the project
      if (!projectId && req.params.id) {
        // We will assume routes using this middleware without projectId are acting on a resource with an ID
        // For tasks:
        if (req.baseUrl.includes('/api/tasks')) {
          const task = await prisma.task.findUnique({ where: { id: req.params.id } });
          if (!task) return res.status(404).json({ error: 'Task not found' });
          projectId = task.projectId;
        }
      }

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID required for permission check' });
      }

      const projectMember = await prisma.projectMember.findFirst({
        where: {
          projectId: projectId,
          userId: req.user.id
        }
      });

      if (!projectMember) {
        return res.status(403).json({ error: 'Forbidden: Not a project member' });
      }

      // If user is a TEAM_LEADER globally, they get all permissions in their projects
      if (
        req.user.globalRole === 'TEAM_LEADER' || 
        projectMember[permissionKey] === true ||
        ((permissionKey === 'canCreateTask' || permissionKey === 'canAssignTask') && req.user.globalRole === 'MEMBER')
      ) {
        return next();
      }

      return res.status(403).json({ error: `Forbidden: Missing permission ${permissionKey}` });
    } catch (error) {
      return res.status(500).json({ error: 'Error checking permissions' });
    }
  };
};

module.exports = checkPermission;
