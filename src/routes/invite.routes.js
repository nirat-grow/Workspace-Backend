const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/invite.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware, inviteController.createInvite);
router.get('/', authMiddleware, inviteController.getInvites);
router.get('/:token', inviteController.validateInvite);
// POST /api/invites/:token/accept is actually handled by POST /api/auth/register since it creates the account

module.exports = router;
