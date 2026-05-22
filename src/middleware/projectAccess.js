const prisma = require("../prisma");

module.exports = async function projectAccess(req, res, next) {
  const projectId = req.params.projectId || req.body.projectId;
  if (!projectId) return res.status(400).json({ message: "projectId required" });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: req.user.id } }
  });

  if (!member && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Project access denied" });
  }

  req.projectMember = member || {
    role: "ADMIN",
    canCreateTask: true,
    canAssignTask: true,
    canEditTask: true,
    canDeleteTask: true
  };

  next();
};
