/** Leaf entries for grouped menus. Group metadata lives in menu.ts. */

export type SourceMenuLeafSeed = {
  tagKey: string;
  label: string;
};

export const OVERSEAS_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "google", label: "Google" },
  { tagKey: "youtube", label: "YouTube" },
  { tagKey: "instagram", label: "Instagram" },
  { tagKey: "facebook", label: "Facebook" },
  { tagKey: "linkedin", label: "LinkedIn（领英）" },
  { tagKey: "tiktok", label: "TikTok" },
  { tagKey: "whatsapp_business", label: "WhatsApp Business" },
  { tagKey: "x_twitter", label: "X（Twitter）" },
  { tagKey: "threads", label: "Threads" },
  { tagKey: "telegram", label: "Telegram" },
  { tagKey: "snapchat", label: "Snapchat" },
  { tagKey: "dailymotion", label: "Dailymotion" },
  { tagKey: "tumblr", label: "Tumblr" },
];

export const WECHAT_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "wechat_video_channel", label: "视频号" },
  { tagKey: "wechat_official_account", label: "公众号" },
  { tagKey: "wechat_search", label: "微信搜一搜" },
  { tagKey: "wechat_moments", label: "微信朋友圈" },
  { tagKey: "wecom", label: "企业微信" },
  { tagKey: "wechat_group", label: "微信群" },
  { tagKey: "wechat_miniprogram", label: "微信小程序" },
  { tagKey: "wechat_other", label: "其他微信渠道" },
];

export const OTHER_PLATFORM_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "kuaishou", label: "快手" },
  { tagKey: "xianyu_taobao", label: "淘宝" },
  { tagKey: "xianyu", label: "闲鱼" },
  { tagKey: "pinduoduo", label: "拼多多" },
  { tagKey: "zhihu", label: "知乎" },
  { tagKey: "bilibili", label: "哔哩哔哩（B站）" },
  { tagKey: "toutiao", label: "今日头条" },
  { tagKey: "xigua_video", label: "西瓜视频" },
  { tagKey: "baijiahao", label: "百家号" },
  { tagKey: "baidu_zhidao", label: "百度知道" },
  { tagKey: "baidu_jingyan", label: "百度经验" },
  { tagKey: "baidu_tieba", label: "百度贴吧" },
  { tagKey: "qq", label: "QQ" },
  { tagKey: "ifeng", label: "凤凰网" },
  { tagKey: "yidian", label: "一点资讯" },
  { tagKey: "uc_toutiao", label: "UC头条" },
  { tagKey: "douban", label: "豆瓣" },
  { tagKey: "jianshu", label: "简书" },
  { tagKey: "csdn", label: "CSDN" },
  { tagKey: "cnblogs", label: "博客园" },
  { tagKey: "segmentfault", label: "SegmentFault" },
  { tagKey: "oschina", label: "开源中国（OSChina）" },
  { tagKey: "zsxq", label: "知识星球" },
  { tagKey: "dedao", label: "得到" },
  { tagKey: "kuaikandian", label: "快看点" },
  { tagKey: "lishipin", label: "梨视频" },
  { tagKey: "qutoutiao", label: "趣头条" },
  { tagKey: "dongfang_toutiao", label: "东方头条" },
  { tagKey: "xueqiu", label: "雪球" },
  { tagKey: "eastmoney", label: "东方财富" },
  { tagKey: "tonghuashun", label: "同花顺" },
  { tagKey: "sina_finance", label: "新浪财经" },
  { tagKey: "other_media_platform", label: "其他媒体平台" },
];

export const COOPERATION_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "partner", label: "合作伙伴" },
  { tagKey: "cross_industry", label: "异业合作" },
  { tagKey: "industry_association", label: "行业协会" },
  { tagKey: "chamber_of_commerce", label: "商会" },
  { tagKey: "cooperation_other", label: "其他合作渠道" },
];

export const B2B_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "maimai", label: "脉脉" },
  { tagKey: "hc360", label: "慧聪网" },
  { tagKey: "global_sources", label: "环球资源（Global Sources）" },
  { tagKey: "dhgate", label: "敦煌网（DHgate）" },
  { tagKey: "b2b_other", label: "其他B2B平台" },
];

export const OUTBOUND_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "cold_call", label: "陌生电话" },
  { tagKey: "public_company_info", label: "公开企业信息渠道" },
  { tagKey: "outbound_other", label: "其他主动开发" },
];

export const OFFLINE_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "offline_event", label: "线下活动" },
  { tagKey: "offline_salon", label: "线下沙龙" },
  { tagKey: "industry_expo", label: "行业展会" },
  { tagKey: "company_lecture", label: "企业讲座" },
  { tagKey: "public_class", label: "公开课" },
  { tagKey: "webinar", label: "网络研讨会（Webinar）" },
  { tagKey: "community_event", label: "社群活动" },
  { tagKey: "walk_in", label: "自然到访" },
  { tagKey: "offline_other", label: "其他线下渠道" },
];

export const OTHER_SOURCE_LEAVES: readonly SourceMenuLeafSeed[] = [
  { tagKey: "other_online", label: "其他线上渠道" },
  { tagKey: "other_offline", label: "其他线下渠道" },
  { tagKey: "source_unknown", label: "来源不明" },
  { tagKey: "other", label: "其他" },
];

/** Direct selectable top-level items (tagKey equals menu selection). */
export const DIRECT_SOURCE_MENU_ITEMS: readonly SourceMenuLeafSeed[] = [
  { tagKey: "xiaohongshu", label: "小红书" },
  { tagKey: "douyin", label: "抖音" },
  { tagKey: "company_website", label: "公司官网" },
  { tagKey: "referral", label: "客户转介绍" },
  { tagKey: "agent_client", label: "代理渠道" },
  { tagKey: "inbound_inquiry", label: "主动咨询" },
];
