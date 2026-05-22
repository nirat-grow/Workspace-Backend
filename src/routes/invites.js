const router = require("express").Router();
const { v4: uuidv4 } = require("uuid");
const prisma = require("../prisma");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const { sendInviteEmail } = require("../services/emailService");

router.post("/", auth, requireRole(["ADMIN"]), async (req, res) => {
  const token = uuidv4();

  const invite = await prisma.invite.create({
    data: {
      email: req.body.email,
      workspaceId: req.body.workspaceId || req.user.workspaceId,
      projectId: req.body.projectId || null,
      role: req.body.role || "MEMBER",
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  const link = `${process.env.FRONTEND_URL || "http://192.168.0.51:5173"}/invite/${token}`;

  // Send invite email via Gmail
  const emailSent = await sendInviteEmail(req.body.email, link, req.body.role || "MEMBER");

  res.json({ invite, link, emailSent });
});

router.get("/", auth, requireRole(["ADMIN"]), async (req, res) => {
  const invites = await prisma.invite.findMany({
    where: { workspaceId: req.user.workspaceId },
    orderBy: { createdAt: "desc" }
  });
  res.json(invites);
});

module.exports = router;

