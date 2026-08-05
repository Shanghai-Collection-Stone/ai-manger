# Netdisk Module

## 模块描述
网盘模块(v2)，租户网盘的真实文件存储与文件/文件夹树 CRUD。`workspaceId` 为空=租户级网盘，非空=工作区内容(工作区也在网盘有内容)。真实二进制经 multer 落本地磁盘(`<cwd>/storage/netdisk/<tenantId>/<yyyy>/<mm>/<uuid.ext>`，可由 `NETDISK_STORAGE_DIR` 覆盖)。容量配额双层:租户根(`disk_roots`)+ 工作区(`workspaces.capacityBytes`，经 `WorkspaceService` 记账)。所有增删改自动埋点审计(`netdisk.*` 动作)。鉴权后台 JWT + CASL(subject `Netdisk`)，租户隔离。
文件路径: `src/modules/netdisk`
路由前缀: `api/v2/netdisk`
环境变量: `NETDISK_STORAGE_DIR`(存储根)、`NETDISK_MAX_UPLOAD_BYTES`(单文件上限，默认 200MB)。
已知限制: 文件夹删除要求为空(不递归)；网盘为租户级资源，平台超管(无租户)不可直接操作，返回 `TENANT_CONTEXT_REQUIRED`。

## 功能描述及关键词

### services/netdisk.service.ts
网盘服务，文件树 CRUD、上传落库、容量配额校验与记账、审计埋点。
- **关键词**: netdisk, file-tree, upload, download, quota, capacity, audit, tenant-isolation, mongo
- **函数**:
  - `ensureIndexes`: 初始化网盘索引/ensure netdisk indexes | keywords: ensure-netdisk-indexes
  - `ensureRoot`: 读取或初始化租户网盘根/ensure tenant disk root | keywords: ensure-tenant-disk-root
  - `getRoot`: 获取租户网盘根/get tenant disk root | keywords: get-tenant-disk-root
  - `updateRootCapacity`: 设置租户网盘总容量/update tenant disk capacity | keywords: update-tenant-disk-capacity
  - `listNodes`: 列出作用域下子节点/list disk nodes | keywords: list-disk-nodes
  - `createFolder`: 创建文件夹/create disk folder | keywords: create-disk-folder
  - `finalizeUpload`: 完成上传(配额校验+落库+记账)/finalize file upload | keywords: finalize-file-upload
  - `getFileForDownload`: 获取下载文件节点与路径/get file for download | keywords: get-file-for-download
  - `renameNode`: 重命名节点/rename disk node | keywords: rename-disk-node
  - `deleteNode`: 删除节点(文件回收配额，文件夹须空)/delete disk node | keywords: delete-disk-node

### services/netdisk-storage.service.ts
网盘物理存储层:multer 磁盘引擎、存储键与绝对路径互转、物理文件删除。
- **关键词**: storage, multer, disk-storage, path, unlink, storage-key
- **函数**:
  - `netdiskBaseDir`: 解析存储根目录/netdisk storage base dir | keywords: netdisk-storage-base-dir
  - `createNetdiskDiskStorage`: 构建 multer 磁盘存储引擎/create netdisk disk storage engine | keywords: create-netdisk-disk-storage-engine
  - `storageKeyOf`: 绝对路径转相对存储键/storage key of abs path | keywords: storage-key-of-abs-path
  - `absPathOf`: 存储键还原绝对路径/abs path of storage key | keywords: abs-path-of-storage-key
  - `deleteByKey`: 删除物理文件/delete stored file | keywords: delete-stored-file

### controller/netdisk.controller.ts
网盘控制器，`api/v2/netdisk` 下节点 CRUD、上传下载、容量端点，逐入口挂 `@RequirePermission`。
- **关键词**: controller, netdisk, upload, download, multipart, casl, jwt, v2
- **函数**:
  - `getRoot`: 获取网盘根端点/get disk root endpoint | keywords: get-disk-root-endpoint
  - `updateRoot`: 设置网盘容量端点/update disk root endpoint | keywords: update-disk-root-endpoint
  - `listNodes`: 列节点端点/list nodes endpoint | keywords: list-nodes-endpoint
  - `createFolder`: 创建文件夹端点/create folder endpoint | keywords: create-folder-endpoint
  - `uploadFile`: 上传文件端点(multipart)/upload file endpoint | keywords: upload-file-endpoint
  - `downloadFile`: 下载文件端点/download file endpoint | keywords: download-file-endpoint
  - `renameNode`: 重命名节点端点/rename node endpoint | keywords: rename-node-endpoint
  - `deleteNode`: 删除节点端点/delete node endpoint | keywords: delete-node-endpoint
  - `requireUser`: 读取当前登录后台用户/read current admin user | keywords: read-current-admin-user

### controller/netdisk.dto.ts
网盘请求体 DTO 及校验(列表/建夹/上传字段/重命名/容量)。
- **关键词**: dto, class-validator, netdisk, upload, folder

### entities/netdisk.entity.ts
网盘节点与租户根实体定义。`workspaceId`/`parentId` 以 `null` 表示租户级/根(与 Mongo 查询 `null` 语义一致)。
- **关键词**: entity, disk-node, disk-root, node-type
- **类型导出**: `DiskNodeEntity`, `DiskRootEntity`, `DiskNodeType`

### constants/netdisk-audit.constants.ts
网盘审计事件动作常量(`netdisk.<verb>`)。
- **关键词**: audit, action, namespace, netdisk
- **类型导出**: `NETDISK_AUDIT_ACTIONS`

### netdisk.module.ts
网盘模块定义，导出 `NetdiskService`。
- **关键词**: module, nest, export-service
