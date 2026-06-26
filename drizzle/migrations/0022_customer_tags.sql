CREATE TABLE `customer_tags` (
  `id` text PRIMARY KEY NOT NULL,
  `tag_key` text NOT NULL,
  `label` text NOT NULL,
  `is_system` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX `customer_tags_tag_key_unique` ON `customer_tags` (`tag_key`);
CREATE INDEX `idx_customer_tags_is_active` ON `customer_tags` (`is_active`);

INSERT INTO `customer_tags` (`id`, `tag_key`, `label`, `is_system`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('ctag-xianyu_taobao', 'xianyu_taobao', '闲鱼 / 淘宝', 0, 1, 1, datetime('now'), datetime('now')),
  ('ctag-xiaohongshu', 'xiaohongshu', '小红书', 0, 1, 2, datetime('now'), datetime('now')),
  ('ctag-douyin', 'douyin', '抖音', 0, 1, 3, datetime('now'), datetime('now')),
  ('ctag-referral', 'referral', '转介绍', 0, 1, 4, datetime('now'), datetime('now')),
  ('ctag-online_media', 'online_media', '线上媒体平台', 0, 1, 5, datetime('now'), datetime('now')),
  ('ctag-agent_client', 'agent_client', '代理客户', 0, 1, 6, datetime('now'), datetime('now')),
  ('ctag-other', 'other', '其他', 1, 1, 99, datetime('now'), datetime('now'));
