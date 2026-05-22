const prisma = require("../prisma");

function taskLine(task, index) {
  const assigned = task.assignedUser ? task.assignedUser.name : "Unassigned";
  const deadline = task.deadline ? new Date(task.deadline).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "No deadline";
  const hours = task.totalHours ? `${task.totalHours}h logged` : "0h logged";
  return `${index}. [${task.priority}] ${task.title}\n   Project: ${task.project.name}\n   Assigned: ${assigned}\n   Status: ${task.status}\n   Deadline: ${deadline}\n   Time: ${hours}`;
}

async function enrichTasks(tasks, workspaceId) {
  const users = await prisma.user.findMany({
    where: { workspaceId },
    select: { id: true, name: true }
  });
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  tasks.forEach(t => {
    t.assignedUser = userMap[t.assignedTo];
    t.totalHours = (t.timeLogs || []).reduce((sum, l) => sum + l.hours, 0);
  });
  return { tasks, userMap };
}

async function getPendingTasks(workspaceId) {
  return prisma.task.findMany({
    where: { workspaceId, status: { not: "DONE" } },
    include: { project: true, timeLogs: true },
    orderBy: [{ priority: "desc" }, { deadline: "asc" }]
  });
}

async function getStuckTasks(workspaceId) {
  const hours = Number(process.env.STUCK_TASK_HOURS || 24);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.task.findMany({
    where: {
      workspaceId,
      status: { in: ["TODO", "PROGRESS", "REVIEW"] },
      updatedAt: { lte: cutoff }
    },
    include: { project: true, timeLogs: true },
    orderBy: { updatedAt: "asc" }
  });
}

async function buildDailyReport(workspaceId) {
  const [pending, stuck] = await Promise.all([
    getPendingTasks(workspaceId),
    getStuckTasks(workspaceId)
  ]);
  await enrichTasks(pending, workspaceId);
  await enrichTasks(stuck, workspaceId);

  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  let msg = `📋 <b>Daily Task Report</b>\nDate: ${today}\n\n`;
  msg += `⏳ <b>Pending Tasks (${pending.length})</b>\n`;
  msg += pending.length ? pending.slice(0, 30).map(taskLine).join("\n\n") : "No pending tasks ✅";
  msg += `\n\n🚨 <b>Stuck Tasks (${stuck.length})</b>\n`;
  msg += stuck.length ? stuck.slice(0, 30).map(taskLine).join("\n\n") : "No stuck tasks ✅";

  return { message: msg, pending, stuck };
}

async function buildWeeklyReport(workspaceId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const created = await prisma.task.findMany({
    where: { workspaceId, createdAt: { gte: weekAgo } },
    include: { project: true, timeLogs: true }
  });
  const completed = await prisma.task.findMany({
    where: { workspaceId, status: "DONE", updatedAt: { gte: weekAgo } },
    include: { project: true, timeLogs: true }
  });
  const pending = await getPendingTasks(workspaceId);

  await enrichTasks(created, workspaceId);
  await enrichTasks(completed, workspaceId);
  await enrichTasks(pending, workspaceId);

  const totalHours = created.reduce((s, t) => s + (t.totalHours || 0), 0) +
                     completed.reduce((s, t) => s + (t.totalHours || 0), 0);

  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  let msg = `📊 <b>Weekly Report</b>\nWeek ending: ${today}\n\n`;
  msg += `✅ <b>Completed (${completed.length})</b>\n`;
  msg += completed.length ? completed.slice(0, 20).map(taskLine).join("\n\n") : "None";
  msg += `\n\n🆕 <b>Created (${created.length})</b>\n`;
  msg += created.length ? created.slice(0, 20).map(taskLine).join("\n\n") : "None";
  msg += `\n\n⏳ <b>Still Pending (${pending.length})</b>`;
  msg += `\n⏱ <b>Total Hours Logged: ${Math.round(totalHours * 100) / 100}h</b>`;

  return { message: msg, created: created.length, completed: completed.length, pending: pending.length, totalHours };
}

async function buildMonthlyReport(workspaceId) {
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const created = await prisma.task.findMany({
    where: { workspaceId, createdAt: { gte: monthAgo } },
    include: { project: true, timeLogs: true }
  });
  const completed = await prisma.task.findMany({
    where: { workspaceId, status: "DONE", updatedAt: { gte: monthAgo } },
    include: { project: true, timeLogs: true }
  });
  const allTasks = await prisma.task.findMany({
    where: { workspaceId },
    include: { timeLogs: true }
  });

  await enrichTasks(created, workspaceId);
  await enrichTasks(completed, workspaceId);

  const totalHours = allTasks.reduce((s, t) => s + t.timeLogs.reduce((a, l) => a + l.hours, 0), 0);

  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  let msg = `📅 <b>Monthly Report</b>\nMonth ending: ${today}\n\n`;
  msg += `🆕 Tasks Created: ${created.length}\n`;
  msg += `✅ Tasks Completed: ${completed.length}\n`;
  msg += `📈 Completion Rate: ${created.length > 0 ? Math.round((completed.length / created.length) * 100) : 0}%\n`;
  msg += `⏱ Total Hours: ${Math.round(totalHours * 100) / 100}h`;

  return { message: msg, created: created.length, completed: completed.length, totalHours };
}

async function buildDeadlineReport(workspaceId) {
  const now = new Date();
  const overdue = await prisma.task.findMany({
    where: {
      workspaceId,
      status: { not: "DONE" },
      deadline: { lt: now }
    },
    include: { project: true, timeLogs: true },
    orderBy: { deadline: "asc" }
  });

  const upcoming = await prisma.task.findMany({
    where: {
      workspaceId,
      status: { not: "DONE" },
      deadline: { gte: now, lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }
    },
    include: { project: true, timeLogs: true },
    orderBy: { deadline: "asc" }
  });

  await enrichTasks(overdue, workspaceId);
  await enrichTasks(upcoming, workspaceId);

  let msg = `🚨 <b>Deadline Report</b>\n\n`;
  msg += `❌ <b>Overdue (${overdue.length})</b>\n`;
  msg += overdue.length ? overdue.slice(0, 20).map(taskLine).join("\n\n") : "None ✅";
  msg += `\n\n⚠️ <b>Due in 3 days (${upcoming.length})</b>\n`;
  msg += upcoming.length ? upcoming.slice(0, 20).map(taskLine).join("\n\n") : "None";

  return { message: msg, overdue, upcoming };
}

async function buildProjectHoursReport(workspaceId) {
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    include: {
      tasks: {
        include: {
          timeLogs: { include: { user: { select: { id: true, name: true } } } }
        }
      }
    }
  });

  const projectData = projects.map(p => {
    let totalHours = 0;
    let totalEstimated = 0;
    const byUser = {};

    p.tasks.forEach(t => {
      totalEstimated += t.estimatedHours || 0;
      t.timeLogs.forEach(l => {
        totalHours += l.hours;
        if (!byUser[l.user.name]) byUser[l.user.name] = 0;
        byUser[l.user.name] += l.hours;
      });
    });

    return {
      projectName: p.name,
      taskCount: p.tasks.length,
      totalHours: Math.round(totalHours * 100) / 100,
      totalEstimated: Math.round(totalEstimated * 100) / 100,
      byUser
    };
  });

  let msg = `⏱ <b>Project Hours Report</b>\n\n`;
  projectData.forEach(p => {
    msg += `📁 <b>${p.projectName}</b>\n`;
    msg += `   Tasks: ${p.taskCount} | Hours: ${p.totalHours}h / ${p.totalEstimated}h estimated\n`;
    Object.entries(p.byUser).forEach(([name, h]) => {
      msg += `   👤 ${name}: ${Math.round(h * 100) / 100}h\n`;
    });
    msg += "\n";
  });

  return { message: msg, projects: projectData };
}

module.exports = { buildDailyReport, buildWeeklyReport, buildMonthlyReport, buildDeadlineReport, buildProjectHoursReport, getPendingTasks, getStuckTasks };
