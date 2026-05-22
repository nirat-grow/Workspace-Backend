const router = require("express").Router();
const prisma = require("../prisma");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const logActivity = require("../services/logActivity");

router.post("/", auth, requireRole(["ADMIN"]), async (req, res) => {
  const project = await prisma.project.create({
    data: {
      name: req.body.name,
      workspaceId: req.body.workspaceId || req.user.workspaceId,
      createdBy: req.user.id,
      members: {
        create: {
          userId: req.user.id,
          role: "ADMIN",
          canCreateTask: true,
          canAssignTask: true,
          canEditTask: true,
          canDeleteTask: true
        }
      }
    }
  });

  await logActivity({
    workspaceId: project.workspaceId,
    projectId: project.id,
    userId: req.user.id,
    action: "PROJECT_CREATED",
    message: `Project created: ${project.name}`,
    newValue: project
  });

  res.json(project);
});

router.get("/", auth, async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: req.user.id } } },
    orderBy: { createdAt: "desc" }
  });
  res.json(projects);
});

router.get("/:projectId/members", auth, async (req, res) => {
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.projectId },
    include: { user: { select: { id: true, name: true, email: true, role: true } } }
  });
  res.json(members);
});

router.post("/:projectId/members", auth, requireRole(["ADMIN"]), async (req, res) => {
  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.params.projectId, userId: req.body.userId } },
    update: {
      role: req.body.role || "MEMBER",
      canCreateTask: req.body.canCreateTask ?? true,
      canAssignTask: req.body.canAssignTask ?? false,
      canEditTask: req.body.canEditTask ?? true,
      canDeleteTask: req.body.canDeleteTask ?? false
    },
    create: {
      projectId: req.params.projectId,
      userId: req.body.userId,
      role: req.body.role || "MEMBER",
      canCreateTask: req.body.canCreateTask ?? true,
      canAssignTask: req.body.canAssignTask ?? false,
      canEditTask: req.body.canEditTask ?? true,
      canDeleteTask: req.body.canDeleteTask ?? false
    }
  });

  res.json(member);
});

module.exports = router;
