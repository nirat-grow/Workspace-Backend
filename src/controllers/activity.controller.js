const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getActivities = async (req, res) => {
  try {
    const { projectId, level, startDate, endDate } = req.query;
    
    let where = {
      project: { workspaceId: req.user.primaryWorkspaceId }
    };
    if (projectId) where.projectId = projectId;
    if (level) where.level = level;
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

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
