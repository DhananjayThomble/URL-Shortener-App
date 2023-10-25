import jwt from 'jsonwebtoken';

export const isApiAuthenticated = async (req, res, next) => {
  //  check if token is present in headers
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // verify the token
  const token = req.headers.authorization.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      req.user = decoded;
      next();
    }
  });
};
