import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as users from '../controllers/usersController.js';

const router = Router();

// User management is staff-only (admin + semi-admin); the controller enforces
// the finer rules (a semi-admin can only touch regular/temporary users).
router.use(requireAuth, requireStaff);

router.get('/', asyncHandler(users.listUsers));
router.post('/', validateBody(users.createUserSchema), asyncHandler(users.createUser));
router.get('/:id/history', asyncHandler(users.userHistory));
router.post(
  '/:id/chat-timeout',
  validateBody(users.chatTimeoutSchema),
  asyncHandler(users.setChatTimeout),
);
router.patch('/:id', validateBody(users.updateUserSchema), asyncHandler(users.updateUser));
router.delete('/:id', asyncHandler(users.deleteUser));

export default router;
