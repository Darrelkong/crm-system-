/** DB field_name values considered sensitive in timeline. */
export const SENSITIVE_FIELD_NAMES = new Set([
  "phone",
  "wechat_id",
  "email",
  "notes",
  "source_remark",
]);

export const FIELD_NAME_LABELS: Record<string, string> = {
  customer_name: "客户名称",
  customer_type: "客户类型",
  phone: "手机号",
  wechat_id: "微信号",
  email: "Email",
  source: "客户来源",
  source_remark: "来源备注",
  sales_stage: "销售阶段",
  lifecycle_status: "客户生命周期",
  status: "状态",
  notes: "备注",
  owner_id: "负责人",
};

export const CUSTOMER_TIMELINE_AUDIT_ACTIONS = new Set([
  "customer.created",
  "customer.updated",
  "customer.imported",
  "customer.released_to_pool",
  "customer.claimed_from_pool",
  "customer.auto_reclaimed_to_pool",
  "customer.transferred",
  "customer.transferred.staff_deleted",
  "customer.closed_won.approved",
  "customer.paid.approved",
  "customer.lifecycle.completed",
  "customer.on_hold_create.approved",
  "customer.on_hold_create.rejected",
  "customer.deleted.soft",
  "customer.auto_reclaim_warning.day_6",
  "customer.auto_reclaim_warning.day_7",
]);

export const TASK_TIMELINE_AUDIT_ACTIONS = new Set([
  "task.created",
  "task.created.first_contact",
  "task.updated",
  "task.completed",
  "task.cancelled.auto_reclaim",
]);

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "customer.created": "客户已创建",
  "customer.updated": "客户资料已更新",
  "customer.imported": "客户已导入",
  "customer.released_to_pool": "客户已释放到公共池",
  "customer.claimed_from_pool": "客户已从公共池领取",
  "customer.auto_reclaimed_to_pool": "客户已自动回收到公共池",
  "customer.transferred": "客户已转移",
  "customer.transferred.staff_deleted": "原负责员工已被删除，客户已自动转交给管理员",
  "customer.closed_won.approved": "成交申请已通过",
  "customer.paid.approved": "客户已付款审批通过",
  "customer.lifecycle.completed": "客户已标记为已完结",
  "customer.on_hold_create.approved": "管理员批准搁置申请",
  "customer.on_hold_create.rejected": "搁置申请已拒绝",
  "customer.deleted.soft": "客户已软删除（归档）",
  "customer.auto_reclaim_warning.day_6": "自动回收预警",
  "customer.auto_reclaim_warning.day_7": "自动回收预警",
  "task.created": "任务已创建",
  "task.created.first_contact": "首次联系任务已创建",
  "task.updated": "任务已更新",
  "task.completed": "任务已完成",
  "task.cancelled.auto_reclaim": "任务已取消（自动回收）",
};

export const TIMELINE_TYPE_UI_LABELS: Record<string, string> = {
  audit: "客户",
  field_change: "字段变更",
  follow_up: "跟进",
  task: "任务",
  approval: "审批",
};

export const TASK_TYPE_LABELS: Record<string, string> = {
  follow_up: "跟进任务",
  first_contact: "首次联系",
  other: "其他任务",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  open: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
