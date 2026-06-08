/**
 * @description Remove legacy featured article default workspaces.
 * @keyword-en featured-article, migration
 */

const LEGACY_DEFAULT_WORKSPACE_NAMES = ['每日精选', '活动专题', '种草选题'];

/**
 * @description Apply cleanup for unedited legacy featured article default workspaces.
 * @keyword-en featured-article, migration-up
 */
async function up(db) {
  const workspaces = db.collection('featured_article_workspaces');
  await workspaces.deleteMany({
    name: { $in: LEGACY_DEFAULT_WORKSPACE_NAMES },
    $or: [
      { pages: { $exists: false } },
      { pages: { $size: 0 } },
    ],
  });
}

/**
 * @description Rollback is intentionally a no-op so removed default demo data is not reintroduced.
 * @keyword-en featured-article, migration-down
 */
async function down() {
  return undefined;
}

module.exports = { up, down };
