const router = require("express").Router();
const prisma = require("../prisma");
const auth = require("../middleware/auth");

router.get("/workspace", auth, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { workspaceId: req.user.workspaceId },
    select: { id: true, name: true, email: true, role: true, telegramId: true }
  });
  res.json(users);
});

module.exports = router;
