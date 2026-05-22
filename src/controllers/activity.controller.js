const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getActivities = async (req, res) => {
  try {
    const { projectId, level } = req.query;
    
    let where = {
      project: { workspaceId: req.user.primaryWorkspaceId }
    };
    if (projectId) where.projectId = projectId;
    if (level) where.level = level;

    const activities = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
