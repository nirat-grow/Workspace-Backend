const router = require("express").Router();
const prisma = require("../prisma");
const auth = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  const items = await prisma.workspace.findMany({
    where: { members: { some: { userId: req.user.id } } }
  });
  res.json(items);
});

module.exports = router;
