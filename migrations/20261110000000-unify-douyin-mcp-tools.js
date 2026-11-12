/** 分镜与探店合并后新增的 MCP 工具：选起点、从图库配画面、AI 生成画面 */
const NEW_TOOLS = [
  'douyin_store_visit_set_start',
  'douyin_store_visit_pick_pictures',
  'douyin_store_visit_generate_pictures',
];
/** 原来就能配画面的密钥才自动授权新工具：探店 AI 配场景，或旧分镜的某镜配图 */
const GRANT_IF_ANY = [
  'douyin_store_visit_match_scenes',
  'douyin_storyboard_shot_image',
];
/** 已下线的旧分镜工具 */
const RETIRED_TOOLS = [
  'douyin_storyboard_generate',
  'douyin_storyboard_shot_image',
  'douyin_storyboard_shot_video',
];

/**
 * @description 分镜与探店合并：给原来能配画面的 MCP 密钥加上新工具（选起点、从图库配画面、AI 生成画面），并从所有密钥里去掉已下线的旧分镜工具。
 * @keyword-cn MCP工具合并迁移, 新工具授权
 * @keyword-en mcp-tools-unify-migration, grant-new-tools
 */
async function up(db) {
  const keys = db.collection('tenant_mcp_keys');
  await keys.updateMany(
    { permissions: { $in: GRANT_IF_ANY } },
    { $addToSet: { permissions: { $each: NEW_TOOLS } } },
  );
  await keys.updateMany(
    { permissions: { $in: RETIRED_TOOLS } },
    { $pull: { permissions: { $in: RETIRED_TOOLS } } },
  );
}

/**
 * @description 回退：去掉新加的三个工具（已下线的旧分镜工具不再加回去，代码里已没有它们）。
 * @keyword-cn MCP工具合并回退, 去掉新工具
 * @keyword-en mcp-tools-unify-rollback, revoke-new-tools
 */
async function down(db) {
  await db
    .collection('tenant_mcp_keys')
    .updateMany(
      { permissions: { $in: NEW_TOOLS } },
      { $pull: { permissions: { $in: NEW_TOOLS } } },
    );
}

module.exports = { up, down };
