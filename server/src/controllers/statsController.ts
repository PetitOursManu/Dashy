import type { Request, Response } from 'express';
import { HostedApp } from '../models/HostedApp.js';
import { User } from '../models/User.js';
import { OpenEvent } from '../models/OpenEvent.js';
import { Activity } from '../models/Activity.js';
import { appDir } from '../config/paths.js';
import { dirSize } from '../utils/dirSize.js';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Dashboard overview: totals, opens-per-month, and the most-opened apps. */
export async function overview(_req: Request, res: Response): Promise<void> {
  const since = new Date();
  since.setMonth(since.getMonth() - 5);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [totalApps, totalUsers, openSum, monthly, topApps] = await Promise.all([
    HostedApp.estimatedDocumentCount(),
    User.estimatedDocumentCount(),
    HostedApp.aggregate<{ _id: null; total: number }>([
      { $group: { _id: null, total: { $sum: '$openCount' } } },
    ]),
    OpenEvent.aggregate<{ _id: { y: number; m: number }; count: number }>([
      { $match: { at: { $gte: since } } },
      { $group: { _id: { y: { $year: '$at' }, m: { $month: '$at' } }, count: { $sum: 1 } } },
    ]),
    HostedApp.find().sort({ openCount: -1 }).limit(5).select('name slug openCount'),
  ]);

  const counts = new Map(monthly.map((m) => [`${m._id.y}-${m._id.m}`, m.count]));
  const opensByMonth: { label: string; count: number }[] = [];
  const cursor = new Date(since);
  for (let i = 0; i < 6; i++) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    opensByMonth.push({ label: MONTH_LABELS[cursor.getMonth()], count: counts.get(`${y}-${m}`) ?? 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  res.json({
    totalApps,
    totalUsers,
    totalOpens: openSum[0]?.total ?? 0,
    opensByMonth,
    topApps: topApps.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      openCount: a.openCount,
    })),
  });
}

/** Recent management activity (most recent first). */
export async function recentActivity(_req: Request, res: Response): Promise<void> {
  const activities = await Activity.find().sort({ at: -1 }).limit(12);
  res.json({ activities: activities.map((a) => a.toJSON()) });
}

/** On-disk storage used by each app. */
export async function storage(_req: Request, res: Response): Promise<void> {
  const apps = await HostedApp.find().select('name');
  const sizes = await Promise.all(
    apps.map(async (a) => ({ id: a.id, name: a.name, size: await dirSize(appDir(a.id)) })),
  );
  sizes.sort((a, b) => b.size - a.size);
  res.json({
    total: sizes.reduce((sum, a) => sum + a.size, 0),
    apps: sizes,
  });
}
