/**
 * @description Create featured article workspace indexes and counter.
 * @keyword-en featured-article, migration
 */

/**
 * @description Apply featured article workspace schema migration.
 * @keyword-en featured-article, migration-up
 */
async function up(db) {
  const workspaces = db.collection('featured_article_workspaces');
  await workspaces.createIndex({ id: 1 }, { unique: true, name: 'id_1' });
  await workspaces.createIndex(
    { scopeId: 1, updatedAt: -1 },
    { name: 'scopeId_1_updatedAt_-1' },
  );
  await workspaces.createIndex(
    { tenantId: 1, updatedAt: -1 },
    { name: 'tenantId_1_updatedAt_-1' },
  );
  await workspaces.createIndex(
    { userId: 1, updatedAt: -1 },
    { name: 'userId_1_updatedAt_-1' },
  );
  await db
    .collection('counters')
    .updateOne(
      { _id: 'featured_article_workspaces' },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );
}

/**
 * @description Roll back featured article workspace schema migration.
 * @keyword-en featured-article, migration-down
 */
async function down(db) {
  const workspaces = db.collection('featured_article_workspaces');
  for (const name of [
    'id_1',
    'scopeId_1_updatedAt_-1',
    'tenantId_1_updatedAt_-1',
    'userId_1_updatedAt_-1',
  ]) {
    try {
      await workspaces.dropIndex(name);
    } catch {
      // ignore missing indexes
    }
  }
  await db
    .collection('counters')
    .deleteOne({ _id: 'featured_article_workspaces' });
}

module.exports = { up, down };
