const router = require("express").Router();
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const { buildDailyReport, buildWeeklyReport, buildMonthlyReport, buildDeadlineReport, buildProjectHoursReport } = require("../services/reportBuilder");
const sendTelegram = require("../services/telegram");

// Daily report
router.get("/daily", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  const report = await buildDailyReport(req.user.workspaceId);
  res.json({
    pendingCount: report.pending.length,
    stuckCount: report.stuck.length,
    message: report.message,
    pending: report.pending,
    stuck: report.stuck
  });
});

// Weekly report
router.get("/weekly", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  const report = await buildWeeklyReport(req.user.workspaceId);
  res.json(report);
});

// Monthly report
router.get("/monthly", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  const report = await buildMonthlyReport(req.user.workspaceId);
  res.json(report);
});

// Deadline / overdue report
router.get("/deadlines", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  const report = await buildDeadlineReport(req.user.workspaceId);
  res.json(report);
});

// Project-wise hours report
router.get("/project-hours", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  const report = await buildProjectHoursReport(req.user.workspaceId);
  res.json(report);
});

// Send daily report via Telegram
router.post("/send-telegram", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  const report = await buildDailyReport(req.user.workspaceId);
  await sendTelegram(report.message);
  res.json({ message: "Report sent to Telegram", pendingCount: report.pending.length, stuckCount: report.stuck.length });
});

// Send any report type via Telegram
router.post("/send-telegram/:type", auth, requireRole(["ADMIN", "MANAGER"]), async (req, res) => {
  let report;
  switch (req.params.type) {
    case "weekly": report = await buildWeeklyReport(req.user.workspaceId); break;
    case "monthly": report = await buildMonthlyReport(req.user.workspaceId); break;
    case "deadlines": report = await buildDeadlineReport(req.user.workspaceId); break;
    case "project-hours": report = await buildProjectHoursReport(req.user.workspaceId); break;
    default: report = await buildDailyReport(req.user.workspaceId); break;
  }
  await sendTelegram(report.message);
  res.json({ message: `${req.params.type} report sent to Telegram` });
});

module.exports = router;
