import { supabase } from '../config/supabase.js';

export async function fetchNotifications(userId, { onlyUnread = false, limit = 50 } = {}) {
  let query = supabase
    .from('notifications')
    .select('*, documents(title)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (onlyUnread) query = query.is('read_at', null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchUnreadCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function markAsRead(id) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markAllAsRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}
