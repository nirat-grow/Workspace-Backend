module.exports = function permission(permissionName) {
  return (req, res, next) => {
    if (req.user.role === "ADMIN") return next();

    if (!req.projectMember || !req.projectMember[permissionName]) {
      return res.status(403).json({ message: `Permission denied: ${permissionName}` });
    }

    next();
  };
};
