const router = require("express").Router();
const prisma = require("../prisma");
const auth = require("../middleware/auth");

router.get("/project/:projectId", auth, async (req, res) => {
  const logs = await prisma.activityLog.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json(logs);
});

router.get("/workspace", auth, async (req, res) => {
  const logs = await prisma.activityLog.findMany({
    where: { workspaceId: req.user.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json(logs);
});

module.exports = router;
