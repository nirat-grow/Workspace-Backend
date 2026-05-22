const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId },
    process.env.JWT_SECRET || "secret",
    { expiresIn: "7d" }
  );
}

router.post("/setup-admin", async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) return res.status(403).json({ message: "Admin already exists" });

  const password = await bcrypt.hash(req.body.password, 10);

  const user = await prisma.user.create({
    data: {
      name: req.body.name,
      email: req.body.email,
      password,
      role: "ADMIN",
      telegramId: req.body.telegramId || null
    }
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: req.body.workspaceName || "Main Workspace",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "ADMIN" } }
    }
  });

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { workspaceId: workspace.id }
  });

  res.json({ token: sign(updatedUser), user: updatedUser, workspace });
});

router.post("/register", async (req, res) => {
  const invite = await prisma.invite.findUnique({ where: { token: req.body.inviteToken } });

  if (!invite || invite.used) return res.status(403).json({ message: "Valid invite required" });
  if (new Date() > invite.expiresAt) return res.status(403).json({ message: "Invite expired" });

  const password = await bcrypt.hash(req.body.password, 10);

  const user = await prisma.user.create({
    data: {
      name: req.body.name,
      email: invite.email,
      password,
      role: invite.role,
      workspaceId: invite.workspaceId,
      telegramId: req.body.telegramId || null
    }
  });

  await prisma.workspaceMember.create({
    data: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role }
  });

  if (invite.projectId) {
    await prisma.projectMember.create({
      data: {
        projectId: invite.projectId,
        userId: user.id,
        role: invite.role,
        canCreateTask: true,
        canAssignTask: invite.role !== "MEMBER",
        canEditTask: true,
        canDeleteTask: invite.role !== "MEMBER"
      }
    });
  }

  await prisma.invite.update({ where: { token: invite.token }, data: { used: true } });

  res.json({ token: sign(user), user });
});

router.post("/login", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!user) return res.status(404).json({ message: "User not found" });

  const ok = await bcrypt.compare(req.body.password, user.password);
  if (!ok) return res.status(401).json({ message: "Wrong password" });

  res.json({ token: sign(user), user });
});

module.exports = router;
