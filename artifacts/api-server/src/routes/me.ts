import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/me", requireAuth, (req, res) => {
  const u = req.user!;
  // Never let the browser (or any intermediate proxy) cache the session
  // probe — otherwise Express's default ETag handling returns 304 on
  // subsequent calls, which the client treats as "not signed in" and
  // bounces the user back to /sign-in immediately after a successful
  // sign-in. See lib/auth.tsx fetchMe.
  res.set("Cache-Control", "no-store");
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    isEngineer: u.isEngineer,
  });
});

export default router;
