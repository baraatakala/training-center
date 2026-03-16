import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { feedbackService, type SessionFeedback, type FeedbackStats } from '../services/feedbackService';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  Line,
} from 'recharts';

const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];

interface SessionOption {
  session_id: string;
  course_name: string;
}

export function FeedbackAnalytics() {
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [feedbacks, setFeedbacks] = useState<SessionFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(false);

  // Load sessions
  useEffect(() => {
    async function loadSessions() {
      const { data } = await supabase
        .from('session')
        .select('session_id, feedback_enabled, course:course_id(course_name)')
        .eq('feedback_enabled', true)
        .order('created_at', { ascending: false });

      if (data) {
        const mapped = data.map((s: Record<string, unknown>) => {
          const course = s.course as Record<string, string> | Record<string, string>[] | null;
          const courseName = Array.isArray(course) ? course[0]?.course_name : course?.course_name;
          return {
            session_id: s.session_id as string,
            course_name: courseName ?? 'Unknown Course',
          };
        });
        setSessions(mapped);
        if (data.length > 0) {
          setSelectedSessionId(data[0].session_id as string);
        }
      }
    }
    loadSessions();
  }, []);

  // Load feedback for selected session
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [fbResult, statsResult] = await Promise.all([
        feedbackService.getBySession(selectedSessionId),
        feedbackService.getStats(selectedSessionId),
      ]);
      if (cancelled) return;
      setFeedbacks(fbResult.data || []);
      setStats(statsResult.data);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  // ─── Derived Data for Charts ─────────────────────────────
  const ratingDistributionData = useMemo(() => {
    if (!stats) return [];
    return [1, 2, 3, 4, 5].map(r => ({
      rating: `${RATING_EMOJIS[r - 1]} ${r}`,
      count: stats.ratingDistribution[r] || 0,
      fill: RATING_COLORS[r - 1],
    }));
  }, [stats]);

  const dailyTrendData = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number; responses: number }>();
    for (const fb of feedbacks) {
      const entry = byDate.get(fb.attendance_date) || { total: 0, count: 0, responses: 0 };
      entry.responses++;
      if (fb.overall_rating != null) {
        entry.total += fb.overall_rating;
        entry.count++;
      }
      byDate.set(fb.attendance_date, entry);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, count, responses }]) => {
        const d = new Date(date);
        return {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          avgRating: count > 0 ? Math.round((total / count) * 10) / 10 : 0,
          responses,
        };
      });
  }, [feedbacks]);

  const methodDistribution = useMemo(() => {
    const byMethod: Record<string, number> = {};
    for (const fb of feedbacks) {
      const method = fb.check_in_method || 'unknown';
      byMethod[method] = (byMethod[method] || 0) + 1;
    }
    return Object.entries(byMethod).map(([name, value]) => ({
      name: name === 'qr_code' ? 'QR Code' : name === 'photo' ? 'Face Recognition' : name,
      value,
    }));
  }, [feedbacks]);

  const anonymousRate = useMemo(() => {
    if (feedbacks.length === 0) return 0;
    const anon = feedbacks.filter(f => f.is_anonymous).length;
    return Math.round((anon / feedbacks.length) * 100);
  }, [feedbacks]);

  // NPS-like score (promoters - detractors)
  const npsScore = useMemo(() => {
    const withRating = feedbacks.filter(f => f.overall_rating != null);
    if (withRating.length === 0) return 0;
    const promoters = withRating.filter(f => f.overall_rating! >= 4).length;
    const detractors = withRating.filter(f => f.overall_rating! <= 2).length;
    return Math.round(((promoters - detractors) / withRating.length) * 100);
  }, [feedbacks]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            💜 Feedback Analytics
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Student feedback insights from post-check-in surveys
          </p>
        </div>
        <div className="w-full sm:w-72">
          <Select
            label=""
            value={selectedSessionId}
            onChange={setSelectedSessionId}
            options={sessions.map(s => ({ value: s.session_id, label: s.course_name }))}
            placeholder="Select session..."
          />
        </div>
      </div>

      {sessions.length === 0 && !loading && (
        <Card>
          <CardContent>
            <div className="text-center py-12">
              <span className="text-5xl block mb-4">📭</span>
              <p className="text-gray-500 dark:text-gray-400">No sessions with feedback enabled yet.</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                Enable feedback in Session settings to start collecting responses.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500" />
        </div>
      )}

      {!loading && stats && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/30 dark:to-violet-900/30 p-4 rounded-xl border border-purple-100 dark:border-purple-800/50">
              <p className="text-xs font-medium text-purple-600 dark:text-purple-400">Total Responses</p>
              <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">{stats.totalResponses}</p>
            </div>
            <div className="bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 p-4 rounded-xl border border-yellow-100 dark:border-yellow-800/50">
              <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Average Rating</p>
              <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">
                {stats.averageRating} <span className="text-lg">{RATING_EMOJIS[Math.round(stats.averageRating) - 1] || ''}</span>
              </p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 p-4 rounded-xl border border-green-100 dark:border-green-800/50">
              <p className="text-xs font-medium text-green-600 dark:text-green-400">Response Rate</p>
              <p className="text-2xl font-bold text-green-900 dark:text-green-100">{stats.responseRate}%</p>
            </div>
            <div className={`bg-gradient-to-br p-4 rounded-xl border ${
              npsScore >= 50 ? 'from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border-emerald-100 dark:border-emerald-800/50'
                : npsScore >= 0 ? 'from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 border-blue-100 dark:border-blue-800/50'
                : 'from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 border-red-100 dark:border-red-800/50'
            }`}>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">NPS Score</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{npsScore > 0 ? '+' : ''}{npsScore}</p>
            </div>
            <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-900/30 dark:to-slate-900/30 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Anonymous</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">🕵️ {anonymousRate}%</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rating Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">⭐ Rating Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={ratingDistributionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                    <XAxis dataKey="rating" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={40}>
                      {ratingDistributionData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Rating Trend Over Time */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">📈 Rating Trend Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                {dailyTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={dailyTrendData}>
                      <defs>
                        <linearGradient id="ratingGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                      <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                      <Tooltip />
                      <Area type="monotone" dataKey="avgRating" stroke="#8b5cf6" fill="url(#ratingGrad)" strokeWidth={2.5} dot={{ r: 4, fill: '#8b5cf6' }} name="Avg Rating" />
                      <Line type="monotone" dataKey="responses" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 3 }} name="Responses" yAxisId={0} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8 text-gray-400 text-sm">No trend data yet</div>
                )}
              </CardContent>
            </Card>

            {/* Check-in Method Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">📱 Feedback by Check-In Method</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={methodDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {methodDistribution.map((_, i) => (
                        <Cell key={i} fill={['#8b5cf6', '#06b6d4', '#f59e0b'][i % 3]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Recent Comments */}
          {stats.recentComments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">💬 Recent Comments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {stats.recentComments.map((c, i) => (
                    <div key={i} className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                      <div className="text-2xl">{RATING_EMOJIS[c.rating - 1] || '❓'}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 dark:text-gray-200">{c.comment}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">{c.date}</span>
                          {c.is_anonymous && (
                            <span className="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                              🕵️ Anonymous
                            </span>
                          )}
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map(s => (
                              <span key={s} className={`text-xs ${s <= c.rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>★</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
