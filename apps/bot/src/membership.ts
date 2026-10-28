// my_chat_member: бота добавили в группу/канал, изменили права или удалили (SPEC §7.4).

export interface ChatMemberStatus {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  can_post_messages?: boolean;
  can_send_messages?: boolean;
}

/** Может ли бот публиковать анонсы в этом чате. */
export function botCanPost(chatType: string, m: ChatMemberStatus): boolean {
  switch (m.status) {
    case 'creator':
      return true;
    case 'administrator':
      // В каналах нужно право публикации, в группах админ пишет всегда.
      return chatType === 'channel' ? m.can_post_messages === true : true;
    case 'member':
      return chatType !== 'channel';
    case 'restricted':
      return m.can_send_messages === true;
    default:
      return false;
  }
}

/** Бот только что оказался в чате (а не, скажем, лишился прав). */
export function joined(
  oldStatus: ChatMemberStatus['status'],
  newStatus: ChatMemberStatus['status'],
) {
  const out = (s: string) => s === 'left' || s === 'kicked';
  return out(oldStatus) && !out(newStatus);
}
