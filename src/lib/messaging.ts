import { Message, MessageResultMap, Response } from '@/types'

/** 发消息给 background，失败时抛出可读错误 */
export async function send<T extends Message['type']>(
  message: Extract<Message, { type: T }>,
): Promise<MessageResultMap[T]> {
  const res = (await chrome.runtime.sendMessage(message)) as
    | Response<MessageResultMap[T]>
    | undefined
  if (!res) throw new Error('后台无响应，请重新加载扩展')
  if (!res.ok) throw new Error(res.error)
  return res.data
}
