import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Copy, Check, X } from 'lucide-react';
import { SkeletonList } from './blocks/shared.jsx';

/**
 * @description 看板配置管理界面（管理端）
 * @keyword-en dashboard config management panel
 */
const DashboardConfigManager = () => {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    dashboardCode: 'ai-commander',
    tenantId: '',
    filePath: '',
    enabled: true,
  });

  // 加载配置映射列表
  const loadMappings = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/admin/dashboard-config/mappings', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMappings(data.rows || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMappings();
  }, []);

  // 处理保存（创建/更新）
  const handleSave = async () => {
    setError('');
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/admin/dashboard-config/mappings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      setFormData({
        dashboardCode: 'ai-commander',
        tenantId: '',
        filePath: '',
        enabled: true,
      });
      setShowForm(false);
      setEditingId(null);
      await loadMappings();
    } catch (err) {
      setError(err.message);
    }
  };

  // 处理删除
  const handleDelete = async (id) => {
    if (!confirm('确定删除此配置映射吗？')) return;
    
    setError('');
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/admin/dashboard-config/mappings/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      await loadMappings();
    } catch (err) {
      setError(err.message);
    }
  };

  // 处理编辑
  const handleEdit = (mapping) => {
    setFormData({
      dashboardCode: mapping.dashboardCode,
      tenantId: mapping.tenantId || '',
      filePath: mapping.filePath,
      enabled: mapping.enabled !== false,
    });
    setEditingId(mapping._id);
    setShowForm(true);
  };

  // 处理新建
  const handleNew = () => {
    setFormData({
      dashboardCode: 'ai-commander',
      tenantId: '',
      filePath: '',
      enabled: true,
    });
    setEditingId(null);
    setShowForm(true);
  };

  // 处理取消
  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({
      dashboardCode: 'ai-commander',
      tenantId: '',
      filePath: '',
      enabled: true,
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">看板配置管理</h1>
        <p className="text-slate-500">管理多租户的看板配置映射</p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* 表单 */}
      {showForm && (
        <div className="mb-6 p-6 bg-white border border-slate-200 rounded-lg shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            {editingId ? '编辑配置映射' : '新建配置映射'}
          </h2>

          <div className="space-y-4">
            {/* Dashboard Code */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                看板代码 *
              </label>
              <input
                type="text"
                value={formData.dashboardCode}
                onChange={(e) =>
                  setFormData({ ...formData, dashboardCode: e.target.value })
                }
                placeholder="e.g., ai-commander"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Tenant ID */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                租户 ID （留空表示母平台）
              </label>
              <input
                type="text"
                value={formData.tenantId}
                onChange={(e) =>
                  setFormData({ ...formData, tenantId: e.target.value })
                }
                placeholder="e.g., super-party"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                对于租户专属配置，填写租户 ID；母平台配置留空
              </p>
            </div>

            {/* File Path */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                配置文件路径 *
              </label>
              <input
                type="text"
                value={formData.filePath}
                onChange={(e) =>
                  setFormData({ ...formData, filePath: e.target.value })
                }
                placeholder="e.g., config/dashboards/platform.dashboard.json"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                必须位于 config/dashboards/ 目录下
              </p>
            </div>

            {/* Enabled */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) =>
                  setFormData({ ...formData, enabled: e.target.checked })
                }
                className="w-4 h-4 border-slate-300 rounded text-indigo-600 focus:ring-2 focus:ring-indigo-500"
              />
              <label htmlFor="enabled" className="ml-2 text-sm font-medium text-slate-700">
                启用此配置
              </label>
            </div>
          </div>

          {/* 按钮 */}
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
            >
              <Check size={16} />
              {editingId ? '更新' : '创建'}
            </button>
          </div>
        </div>
      )}

      {/* 新建按钮 */}
      {!showForm && (
        <div className="mb-6">
          <button
            onClick={handleNew}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
          >
            <Plus size={16} />
            新建配置映射
          </button>
        </div>
      )}

      {/* 加载中 */}
      {loading ? (
        <SkeletonList rows={4} rowClassName="h-16" />
      ) : mappings.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          暂无配置映射。点击"新建配置映射"开始添加。
        </div>
      ) : (
        /* 配置列表 */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">看板代码</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">租户 ID</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">配置文件路径</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">状态</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">操作</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping, idx) => (
                <tr
                  key={mapping._id}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                >
                  <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                    {mapping.dashboardCode}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {mapping.tenantId ? (
                      <span className="inline-block px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                        {mapping.tenantId}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">母平台</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                    {mapping.filePath}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        mapping.enabled
                          ? 'bg-green-50 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {mapping.enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(mapping)}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-600 transition"
                        title="编辑"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(mapping._id)}
                        className="p-1.5 hover:bg-red-50 rounded text-red-600 transition"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 快速参考 */}
      <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <h3 className="font-semibold text-slate-900 mb-2">快速参考</h3>
        <ul className="text-sm text-slate-600 space-y-1">
          <li>• 母平台配置：租户 ID 留空</li>
          <li>• 租户定制配置：填写租户 ID（会优先使用此配置）</li>
          <li>• 配置文件必须位于 config/dashboards/ 目录下</li>
          <li>• 参考 <code className="bg-white px-1 rounded text-xs">DASHBOARD_CONFIG_SPEC.md</code> 了解详细规范</li>
        </ul>
      </div>
    </div>
  );
};

export default DashboardConfigManager;
