const express = require('express');
const router = express.Router();
const prisma = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({ include: { project: true } });
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    
    res.json({
      message: "Database Debug Info",
      totalTasks: tasks.length,
      tasks: tasks.map(t => ({ title: t.title, project: t.project.name, key: t.taskKey })),
      existingTables: tables.map(t => t.table_name)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
