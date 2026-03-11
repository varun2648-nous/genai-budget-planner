function errorHandler(err, req, res, _next) {
  console.error("[ERROR]", err);

  const status = err.statusCode || 500;
  const message = status >= 500 ? "Internal server error" : err.message;

  res.status(status).json({
    message,
    details: process.env.NODE_ENV === "development" ? err.stack : undefined
  });
}

module.exports = {
  errorHandler
};