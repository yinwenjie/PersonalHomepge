# 加密文件缓存组件候选

## 状态

- 当前状态：候选需求，未排期。
- 建议阶段：Phase 2 或 Phase 1.10 之后的独立小阶段。
- 需求定位：轻量级文件缓存，不做完整网盘、不做公开分享、不做多人协作。
- 目标用户：登录用户，希望在一个浏览器上传临时文件，在另一个已登录并可访问同一首页空间的浏览器中下载。

## 需求摘要

实现一个轻量级文件缓存组件：

- 用户在首页空间中上传一个文件。
- 浏览器端先加密文件内容，再上传密文到服务器。
- 另一个浏览器登录同一账号并进入同一首页空间后，可以看到文件条目、下载密文、在本地解密并保存。
- 服务端只保存密文、必要元数据和访问控制信息，不保存文件明文。

## 技术可行性结论

可以实现，Supabase Storage 可以作为 v1 的存储底座：

- Supabase Storage 支持 bucket、文件上传下载、私有访问和基于 `storage.objects` 的 RLS 策略。
- 当前项目已经接入 Supabase Auth、账号首页空间和 RLS，文件缓存可以沿用 `auth.uid()` 与 `home_spaces.user_id` 做访问控制。
- 当前项目已经有 `HKDF + AES-GCM` 的浏览器端加密实现，文件加密可以抽出通用 Web Crypto helper 后复用同一类算法。
- v1 应限制为小文件或中小文件，避免一开始引入大文件分片、断点续传、上传恢复和复杂进度恢复。

## 端到端加密边界

严格端到端加密的关键点是：Supabase 不能拿到可解密文件的密钥。

不推荐把文件解密密钥直接长期保存在 `home_space_credentials.encryption_key` 或 Supabase 表中，然后宣称严格 E2EE。这样体验简单，但服务端数据库里存在可恢复明文的关键材料，只能称为“客户端加密后存储”，不能称为严格端到端加密。

推荐 v1 使用独立的“文件缓存解锁口令”：

- 用户首次启用文件缓存时设置一个口令。
- 浏览器用 PBKDF2 或 Argon2id 派生主密钥。
- 每个文件生成随机 file key，用 file key 加密文件内容。
- file key 再用主密钥包裹后写入元数据。
- 新浏览器登录账号后，仍需要用户输入文件缓存口令才能解密文件。

这个方案牺牲一点便利性，但安全边界清楚：登录账号只能拿到密文和元数据，真正解密依赖用户掌握的口令。

## 推荐 v1 范围

包含：

- 首页组件：`file.cache`。
- 登录用户和账号托管首页空间可用，未登录用户只显示不可用提示。
- 上传单个文件或少量文件。
- 文件列表展示：文件名、大小、上传时间、过期时间、状态。
- 下载并本地解密。
- 删除文件条目和 Storage 对象。
- TTL 过期提示，默认 7 天或 30 天后过期。
- 单文件大小限制，建议 v1 从 20MB 或 25MB 开始。

不包含：

- 大文件断点续传。
- 多人共享。
- 公开链接分享。
- 跨账号发送文件。
- 在线预览 Office、PDF、图片等复杂内容。
- 文件夹、版本管理、全文搜索。
- 忘记口令后的恢复。

## 数据模型草案

### Supabase Storage

- bucket：`home-file-cache`
- 建议私有 bucket。
- object path 建议格式：

```text
users/{user_id}/home-spaces/{home_space_id}/files/{file_id}.bin
```

### Postgres 元数据表

候选表：`home_file_cache_items`

```sql
create table public.home_file_cache_items (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  home_space_id uuid not null references public.home_spaces(id) on delete cascade,
  bucket_id text not null default 'home-file-cache',
  object_path text not null,
  encrypted_name text not null,
  name_iv text not null,
  content_iv text not null,
  key_salt text not null,
  wrapped_file_key text not null,
  plaintext_size bigint not null,
  ciphertext_size bigint not null,
  mime_hint text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

说明：

- `encrypted_name` 用于避免服务端直接看到原始文件名。
- `mime_hint` 可选；如果要更强隐私，v1 可以只保存通用类型或不保存。
- `plaintext_size` 和 `ciphertext_size` 会泄露大致文件大小，v1 可接受；更强隐私可后续考虑 padding。
- `wrapped_file_key` 是被用户口令派生主密钥加密后的 file key。

## RLS 与访问控制草案

元数据表：

- `select`：只能读取 `user_id = auth.uid()` 的行。
- `insert`：只能写入自己的 `user_id`，且 `home_space_id` 必须属于当前用户。
- `update/delete`：只能操作自己的行。

Storage objects：

- 只允许用户访问自己路径下的对象。
- 更稳妥的策略是通过 `home_file_cache_items.object_path` 反查归属，而不是只依赖路径字符串。
- v1 可以先走 Supabase JS SDK 直接上传/下载私有对象；若策略复杂或需要原子清理，再补 RPC。

## 前端流程草案

### 上传

1. 校验登录状态和当前首页空间。
2. 校验文件大小、数量和类型。
3. 如果未解锁文件缓存，要求输入文件缓存口令。
4. 生成随机 file key 和 `content_iv`。
5. 使用 AES-GCM 加密文件内容。
6. 使用主密钥加密 file key。
7. 使用主密钥或 file key 加密文件名。
8. 上传密文 Blob 到 Supabase Storage。
9. 写入 `home_file_cache_items` 元数据。
10. 组件列表显示上传成功。

### 下载

1. 读取元数据列表。
2. 如果未解锁文件缓存，要求输入文件缓存口令。
3. 下载密文 Blob。
4. 解密 wrapped file key。
5. 用 file key 解密文件内容。
6. 创建 Object URL，触发浏览器下载。
7. 下载完成后释放 Object URL。

## 与现有架构的关系

- 不应写入 `HomeDocumentV2.widgets[].config` 的大数据，只保存组件设置和轻量引用。
- 文件元数据放在独立表，Storage 存密文文件，避免首页文档变大。
- 文件缓存组件可以接入现有 Widget Registry，作为新 widget 类型。
- 当前 `sync_spaces` 的首页文档同步不应承载文件内容，也不应因为文件上传触发整份首页文档冲突。
- 账号托管首页空间是最适合的入口；普通同步码空间是否支持文件缓存需要另行设计。

## 风险点

- 内存压力：Web Crypto 一次性加密大文件可能导致浏览器内存占用高，v1 必须限制文件大小。
- 密钥丢失：严格 E2EE 下，忘记口令无法恢复文件。
- XSS 风险：前端运行环境能接触明文和密钥，后续需要更严格的 CSP、依赖审计和输入输出边界。
- 元数据隐私：文件大小、数量、上传时间、过期时间仍会暴露给服务端。
- 清理策略：Storage 对象和元数据需要避免孤儿文件；上传失败、写元数据失败、删除失败都要有补偿。
- 成本控制：文件能力会引入 Storage 容量、下载流量和滥用风险，需要账号级 quota。
- Supabase Free 项目文件大小和容量限制较低，正式开放前需要确认当前套餐、bucket limit 和配额策略。

## 验收标准候选

- 登录用户能在账号托管首页空间中上传一个小文件。
- Supabase Storage 中只能看到密文文件，不能直接得到明文文件名和内容。
- 另一个浏览器登录同一账号、进入同一首页空间、输入文件缓存口令后，可以下载并还原原文件。
- 未输入或输入错误口令时，无法解密文件。
- 删除文件后，元数据和 Storage 对象都被清理。
- 未登录、Supabase 未配置、非账号托管空间下有明确降级提示。
- 单文件超过 v1 限制时拒绝上传并显示原因。

## 后续增强候选

- 大文件可恢复上传：TUS/resumable upload。
- 分片加密，降低内存压力。
- 文件缓存 quota：按账号、空间、单文件、总容量限制。
- 过期自动清理任务。
- 多设备密钥授权，减少每台新设备输入口令的频率。
- 文件分享链接，但必须重新设计访问令牌和密钥分发。
- 付费容量和高级保留时长。

## 参考资料

- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Storage standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Supabase Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [MDN Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [MDN SubtleCrypto encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
