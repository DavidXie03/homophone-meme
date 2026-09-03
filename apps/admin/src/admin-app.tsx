import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  CircleCheckBig,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  ExternalLink,
  ListOrdered,
  LogOut,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Tags,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react"

import type { ApiEnvelope, Entity } from "../../../packages/core/src/index"

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:43128"
const PUBLIC_WEB_URL =
  import.meta.env.VITE_PUBLIC_WEB_URL ?? "http://127.0.0.1:43127"

type EntityInput = Omit<
  Entity,
  "id" | "createdAt" | "updatedAt" | "triggers"
> & {
  triggers: Array<Omit<Entity["triggers"][number], "id">>
}

type FormState = {
  displayName: string
  triggers: string
  pack: string
  category: string
  description: string
  imageUrl: string
  popularity: number
  source: string
  licenseStatus: Entity["licenseStatus"]
  enabled: boolean
}

type CatalogSourceSummary = {
  id: string
  label: string
  description: string
  provider: string
  sourceUrl: string
  defaultLimit: number
}

type SyncResult = {
  fetched: number
  created: number
  updated: number
}

const EMPTY_FORM: FormState = {
  displayName: "",
  triggers: "",
  pack: "自定义",
  category: "流行文化",
  description: "",
  imageUrl: "/entities/squirtle-official.png",
  popularity: 50,
  source: "手工录入",
  licenseStatus: "unknown",
  enabled: true,
}

const PAGE_SIZE = 30

async function api<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}/admin/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const body = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || body.error || !body.data) {
    throw new Error(body.error?.message ?? "请求失败")
  }
  return body.data
}

function imageUrl(value: string) {
  return value.startsWith("/") ? `${PUBLIC_WEB_URL}${value}` : value
}

function formFromEntity(entity: Entity): FormState {
  return {
    displayName: entity.displayName,
    triggers: entity.triggers.map((trigger) => trigger.text).join("、"),
    pack: entity.pack,
    category: entity.category,
    description: entity.description,
    imageUrl: entity.imageUrl,
    popularity: entity.popularity,
    source: entity.source,
    licenseStatus: entity.licenseStatus,
    enabled: entity.enabled,
  }
}

function inputFromForm(form: FormState): EntityInput {
  return {
    ...form,
    triggers: form.triggers
      .split(/[、,，\s]+/u)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ text, kind: "manual", weight: 15 })),
  }
}

export function AdminApp() {
  const [token, setToken] = useState(
    () => window.sessionStorage.getItem("admin-token") ?? "",
  )
  const [draftToken, setDraftToken] = useState("")
  const [entities, setEntities] = useState<Entity[]>([])
  const [sources, setSources] = useState<CatalogSourceSummary[]>([])
  const [syncingSource, setSyncingSource] = useState<string | null>(null)
  const [view, setView] = useState<"entities" | "sources">("entities")
  const [query, setQuery] = useState("")
  const [packFilter, setPackFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Entity | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!token) return
    let active = true
    Promise.all([
      api<Entity[]>("/entities", token),
      api<CatalogSourceSummary[]>("/catalog/sources", token),
    ])
      .then(([entityResult, sourceResult]) => {
        if (!active) return
        setEntities(entityResult)
        setSources(sourceResult)
      })
      .catch((nextError) => {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : "登录失败")
        window.sessionStorage.removeItem("admin-token")
        setToken("")
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [token])

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    return entities.filter((entity) => {
      if (packFilter && entity.pack !== packFilter) return false
      if (categoryFilter && entity.category !== categoryFilter) return false
      if (!value) return true
      return [
        entity.displayName,
        entity.pack,
        entity.category,
        ...entity.triggers.map((trigger) => trigger.text),
      ]
        .join(" ")
        .toLowerCase()
        .includes(value)
    })
  }, [categoryFilter, entities, packFilter, query])
  const packs = useMemo(
    () => [...new Set(entities.map((entity) => entity.pack))].sort(),
    [entities],
  )
  const categories = useMemo(
    () => [...new Set(entities.map((entity) => entity.category))].sort(),
    [entities],
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedEntities = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  async function refresh() {
    setBusy(true)
    setError("")
    try {
      const result = await api<Entity[]>("/entities", token)
      setEntities(result)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "刷新失败")
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!form.displayName.trim() || !form.triggers.trim()) {
      setError("实体名和触发词不能为空")
      return
    }
    setBusy(true)
    setError("")
    try {
      const path = editing ? `/entities/${editing.id}` : "/entities"
      await api<Entity>(path, token, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(inputFromForm(form)),
      })
      setShowForm(false)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败")
      setBusy(false)
    }
  }

  async function toggle(entity: Entity) {
    await api<Entity>(`/entities/${entity.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !entity.enabled }),
    })
    await refresh()
  }

  async function remove(entity: Entity) {
    if (!window.confirm(`删除「${entity.displayName}」？`)) return
    await api<{ removed: boolean }>(`/entities/${entity.id}`, token, {
      method: "DELETE",
    })
    await refresh()
  }

  function requestSync(source: CatalogSourceSummary) {
    return api<SyncResult>(`/catalog/sources/${source.id}/sync`, token, {
      method: "POST",
      body: JSON.stringify({ limit: source.defaultLimit }),
    })
  }

  async function syncSource(source: CatalogSourceSummary) {
    setSyncingSource(source.id)
    setError("")
    try {
      const result = await requestSync(source)
      await refresh()
      window.alert(
        `${source.label}：新增 ${result.created}，更新 ${result.updated}`,
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "同步失败")
    } finally {
      setSyncingSource(null)
    }
  }

  async function syncAllSources() {
    setSyncingSource("all")
    setError("")
    const results: SyncResult[] = []
    const failures: string[] = []
    for (const source of sources) {
      try {
        results.push(await requestSync(source))
      } catch {
        failures.push(source.label)
      }
    }
    await refresh()
    setSyncingSource(null)
    const created = results.reduce((sum, result) => sum + result.created, 0)
    const updated = results.reduce((sum, result) => sum + result.updated, 0)
    if (failures.length) {
      setError(`更新失败：${failures.join("、")}`)
    }
    window.alert(
      `新增 ${created}，更新 ${updated}` +
        (failures.length ? `；失败 ${failures.length} 个` : ""),
    )
  }

  function logout() {
    window.sessionStorage.removeItem("admin-token")
    setView("entities")
    setToken("")
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(entity: Entity) {
    setEditing(entity)
    setForm(formFromEntity(entity))
    setShowForm(true)
  }

  if (!token) {
    return (
      <main className="login-shell">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault()
            setBusy(true)
            setError("")
            window.sessionStorage.setItem("admin-token", draftToken)
            setToken(draftToken)
          }}
        >
          <h1>词库管理</h1>
          <input
            type="password"
            value={draftToken}
            autoFocus
            placeholder="ADMIN_API_TOKEN"
            onChange={(event) => setDraftToken(event.target.value)}
          />
          {error ? <div className="error">{error}</div> : null}
          <button disabled={!draftToken || busy}>{busy ? "验证中…" : "进入"}</button>
        </form>
      </main>
    )
  }

  if (view === "sources") {
    return (
      <SourcesView
        sources={sources}
        error={error}
        syncingSource={syncingSource}
        onBack={() => setView("entities")}
        onSync={(source) => void syncSource(source)}
        onSyncAll={() => void syncAllSources()}
        onLogout={logout}
      />
    )
  }

  return (
    <main className="admin-shell">
      <header>
        <div>
          <h1>词库管理</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="数据源"
            title="数据源"
            onClick={() => setView("sources")}
          >
            <Database />
          </button>
          <button
            className="secondary icon-button"
            aria-label="退出"
            title="退出"
            onClick={logout}
          >
            <LogOut />
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats">
        <article>
          <span aria-label="启用实体" title="启用实体"><CircleCheckBig /></span>
          <strong>{entities.filter((item) => item.enabled).length}</strong>
        </article>
        <article>
          <span aria-label="实体包" title="实体包"><Package /></span>
          <strong>{new Set(entities.map((item) => item.pack)).size}</strong>
        </article>
        <article>
          <span aria-label="触发词" title="触发词"><Tags /></span>
          <strong>{entities.reduce((sum, item) => sum + item.triggers.length, 0)}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="filters">
            <input
              type="search"
              value={query}
              placeholder="搜索实体或触发词"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            <select
              value={packFilter}
              aria-label="按 Pack 筛选"
              onChange={(event) => {
                setPackFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="">全部 Pack</option>
              {packs.map((pack) => (
                <option key={pack} value={pack}>{pack}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              aria-label="按分类筛选"
              onChange={(event) => {
                setCategoryFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="">全部分类</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <button
            className="icon-button"
            aria-label="新增实体"
            title="新增实体"
            onClick={openCreate}
          >
            <Plus />
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>实体</th><th>触发词</th><th>Pack</th><th>分类</th><th>授权</th><th>状态</th><th /></tr>
            </thead>
            <tbody>
              {pagedEntities.map((entity) => (
                <tr key={entity.id}>
                  <td>
                    <div className="entity">
                      {/* Runtime-configured images cannot use a build-time loader. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl(entity.imageUrl)} alt="" />
                      <div>
                        <strong>{entity.displayName}</strong>
                        <small title={entity.description}>
                          {entity.description}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{entity.triggers.map((trigger) => <span className="chip" key={trigger.id}>{trigger.text}</span>)}</td>
                  <td>{entity.pack}</td>
                  <td>{entity.category}</td>
                  <td><span className="chip">{entity.licenseStatus}</span></td>
                  <td>
                    <button
                      className="link icon-link"
                      aria-label={`${entity.enabled ? "停用" : "启用"} ${entity.displayName}`}
                      title={entity.enabled ? "停用" : "启用"}
                      onClick={() => void toggle(entity)}
                    >
                      {entity.enabled ? <ToggleRight /> : <ToggleLeft />}
                    </button>
                  </td>
                  <td className="actions">
                    <button
                      className="link icon-link"
                      aria-label={`编辑 ${entity.displayName}`}
                      title="编辑"
                      onClick={() => openEdit(entity)}
                    >
                      <Pencil />
                    </button>
                    <button
                      className="link danger icon-link"
                      aria-label={`删除 ${entity.displayName}`}
                      title="删除"
                      onClick={() => void remove(entity)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td className="empty" colSpan={7}>没有符合条件的实体</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {filtered.length ? (
          <div className="pagination">
            <span>
              第 {currentPage} / {totalPages} 页 · 共 {filtered.length} 条
            </span>
            <div>
              <button
                type="button"
                className="secondary icon-button"
                aria-label="首页"
                title="首页"
                disabled={currentPage === 1}
                onClick={() => setPage(1)}
              >
                <ChevronsLeft />
              </button>
              <button
                type="button"
                className="secondary icon-button"
                aria-label="上一页"
                title="上一页"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className="secondary icon-button"
                aria-label="下一页"
                title="下一页"
                disabled={currentPage === totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight />
              </button>
              <button
                type="button"
                className="secondary icon-button"
                aria-label="末页"
                title="末页"
                disabled={currentPage === totalPages}
                onClick={() => setPage(totalPages)}
              >
                <ChevronsRight />
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {showForm ? (
        <div className="modal-backdrop" onMouseDown={() => setShowForm(false)}>
          <form
            className="modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <h2>{editing ? "编辑实体" : "新增实体"}</h2>
            <div className="form-grid">
              <Field label="实体名"><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
              <Field label="触发词"><input value={form.triggers} onChange={(e) => setForm({ ...form, triggers: e.target.value })} /></Field>
              <Field label="Pack"><input value={form.pack} onChange={(e) => setForm({ ...form, pack: e.target.value })} /></Field>
              <Field label="分类"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
              <Field label="图片 URL" wide><input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} /></Field>
              <Field label="热度"><input type="number" min="0" max="100" value={form.popularity} onChange={(e) => setForm({ ...form, popularity: Number(e.target.value) })} /></Field>
              <Field label="授权"><select value={form.licenseStatus} onChange={(e) => setForm({ ...form, licenseStatus: e.target.value as Entity["licenseStatus"] })}><option value="unknown">unknown</option><option value="prototype">prototype</option><option value="open">open</option><option value="licensed">licensed</option></select></Field>
              <Field label="说明" wide><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary icon-button"
                aria-label="取消"
                title="取消"
                onClick={() => setShowForm(false)}
              >
                <X />
              </button>
              <button
                className="icon-button"
                aria-label="保存"
                title="保存"
                disabled={busy}
              >
                <Save />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  )
}

function SourcesView({
  sources,
  error,
  syncingSource,
  onBack,
  onSync,
  onSyncAll,
  onLogout,
}: {
  sources: CatalogSourceSummary[]
  error: string
  syncingSource: string | null
  onBack: () => void
  onSync: (source: CatalogSourceSummary) => void
  onSyncAll: () => void
  onLogout: () => void
}) {
  return (
    <main className="admin-shell">
      <header>
        <div>
          <button
            className="back-link icon-button"
            aria-label="返回词库"
            title="返回词库"
            onClick={onBack}
          >
            <ChevronLeft />
          </button>
          <h1>数据源管理</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="全部更新"
            title="全部更新"
            disabled={syncingSource !== null}
            onClick={onSyncAll}
          >
            <RefreshCw className={syncingSource === "all" ? "spinning" : ""} />
          </button>
          <button
            className="secondary icon-button"
            aria-label="退出"
            title="退出"
            onClick={onLogout}
          >
            <LogOut />
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="source-detail-panel">
        <div className="source-detail-list">
          {sources.map((source) => (
            <article key={source.id}>
              <div className="source-title">
                <strong>{source.label}</strong>
                <small title={source.description}>{source.description}</small>
              </div>
              <dl>
                <div>
                  <dt aria-label="数据来源" title="数据来源">
                    <ExternalLink />
                  </dt>
                  <dd>
                    <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                      {source.provider}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt aria-label="单次规模" title="单次规模">
                    <ListOrdered />
                  </dt>
                  <dd>{source.defaultLimit} 条</dd>
                </div>
              </dl>
              <button
                className="icon-button"
                aria-label={`更新 ${source.label}`}
                title="更新"
                disabled={syncingSource !== null}
                onClick={() => onSync(source)}
              >
                <RefreshCw
                  className={syncingSource === source.id ? "spinning" : ""}
                />
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: ReactNode
}) {
  return <label className={wide ? "wide" : ""}><span>{label}</span>{children}</label>
}
