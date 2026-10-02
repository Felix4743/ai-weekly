/**
 * 应用级的设置。
 *
 * 0.9.0 把「专属采访者」删掉了：这一版 AI 是分析方，不是提问方，
 * 用户不需要再维护一段人设提示词。设置页只剩「连哪个模型」这一件事。
 */

export interface AppConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function createDefaultConfig(): AppConfig {
  return {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  }
}
