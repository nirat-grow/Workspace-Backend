const prisma = require('../config/db');

exports.addTimeLog = async (req, res) => {
  try {
    const { id } = req.params; // taskId
    const { hours, note } = req.body;

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const timeLog = await prisma.timeLog.create({
      data: {
        hours: parseFloat(hours),
        note,
        taskId: id,
        userId: req.user.id
      },
      include: { user: { select: { id: true, name: true } } }
    });

    res.status(201).json(timeLog);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getTaskTimeLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const timeLogs = await prisma.timeLog.findMany({
      where: { taskId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { loggedAt: 'desc' }
    });

    res.json(timeLogs);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
