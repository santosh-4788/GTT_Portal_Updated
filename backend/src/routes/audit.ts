import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('audit.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    search: p.search ?? '',
    action: p.action ?? '',
    userId: p.userId ? Number(p.userId) : 0,
    entityType: p.entityType ?? '',
    from: p.from ?? '',
    to: p.to ?? '',
    limit: Math.min(Number(p.limit ?? 100), 500),
    offset: Number(p.offset ?? 0),
  };

  const where = `
    WHERE (@search = '' OR a.description LIKE '%'||@search||'%' OR a.user_email LIKE '%'||@search||'%')
      AND (@action = '' OR a.action = @action)
      AND (@userId = 0 OR a.user_id = @userId)
      AND (@entityType = '' OR a.entity_type = @entityType)
      AND (@from = '' OR date(a.created_at) >= @from)
      AND (@to = '' OR date(a.created_at) <= @to)`;

  res.json({
    data: q.all<any>(
      `SELECT a.*, u.full_name AS user_name FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id ${where}
        ORDER BY a.id DESC LIMIT @limit OFFSET @offset`,
      params
    ),
    total: q.get<any>(`SELECT COUNT(*) c FROM audit_logs a ${where}`, params)!.c,
    actions: q.all<any>('SELECT DISTINCT action FROM audit_logs ORDER BY action').map((r: any) => r.action),
  });
});

export default router;
