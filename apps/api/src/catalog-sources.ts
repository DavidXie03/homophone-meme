import pokemon from "pokemon"

import type { Entity, Trigger } from "../../../packages/core/src/index"

export type CatalogSourceId =
  | "pokemon"
  | "riot"
  | "genshin"
  | "starrail"
  | "bangumi"
  | "wikipedia-history"
  | "wikipedia-celebrities"
  | "netease-musicians"
  | "netease-groups"

export type CatalogSource = {
  id: CatalogSourceId
  label: string
  description: string
  provider: string
  sourceUrl: string
  defaultLimit: number
  sync(limit: number): Promise<Entity[]>
}

const HAN = /\p{Script=Han}/u
const NAME_SEPARATOR = /[\s·•・—\-!?！？。:：、（）()《》“”"'’]/u

function normalizeHanName(value: string) {
  return Array.from(value)
    .filter((character) => HAN.test(character))
    .join("")
}

function latinSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
}

function completeHanName(value: string) {
  const characters = Array.from(value.trim())
  if (
    characters.some(
      (character) => !HAN.test(character) && !NAME_SEPARATOR.test(character),
    )
  ) {
    return ""
  }
  return characters.filter((character) => HAN.test(character)).join("")
}

export function triggersFor(id: string, names: string[]) {
  const triggers: Trigger[] = []
  const seen = new Set<string>()
  for (const rawName of names) {
    const name = completeHanName(rawName)
    if (name.length < 2 || name.length > 6 || seen.has(name)) continue
    seen.add(name)
    triggers.push({
      id: `${id}-trigger-${triggers.length + 1}`,
      text: name,
      kind: "full",
      weight: 12,
    })
  }
  return triggers
}

function entity(input: {
  id: string
  displayName: string
  pack: string
  category: string
  imageUrl: string
  source: string
  popularity: number
  aliases?: string[]
}): Entity | null {
  const triggers = triggersFor(input.id, [
    input.displayName,
    ...(input.aliases ?? []),
  ])
  if (!triggers.length || !input.imageUrl) return null
  const now = new Date().toISOString()
  return {
    id: input.id,
    displayName: normalizeHanName(input.displayName) || input.displayName,
    pack: input.pack,
    category: input.category,
    description: `${input.pack} · ${input.category}`,
    imageUrl: input.imageUrl,
    source: input.source,
    licenseStatus: "prototype",
    enabled: true,
    popularity: Math.max(0, Math.min(100, Math.round(input.popularity))),
    triggers,
    createdAt: now,
    updatedAt: now,
  }
}

type WikipediaPage = {
  pageid: number
  title: string
  thumbnail?: {
    source?: string
  }
  pageviews?: Record<string, number | null>
}

type WikipediaSourceOptions = {
  id: CatalogSourceId
  label: string
  description: string
  pack: string
  category: string
  categories: string[]
  defaultLimit: number
}

const WIKIPEDIA_API = "https://zh.wikipedia.org/w/api.php"
const WIKIPEDIA_HEADERS = {
  accept: "application/json",
  "user-agent": "homophone-meme/0.1",
}

async function wikipediaApi<T>(parameters: Record<string, string>): Promise<T> {
  const url = new URL(WIKIPEDIA_API)
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    variant: "zh-cn",
    ...parameters,
  })) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url, { headers: WIKIPEDIA_HEADERS })
  if (!response.ok) {
    throw new Error(`WIKIPEDIA_SYNC_FAILED_${response.status}`)
  }
  return (await response.json()) as T
}

async function wikipediaPages(categories: string[]) {
  const pages = new Map<number, WikipediaPage>()
  for (const category of categories) {
    const payload = await wikipediaApi<{
      query?: { pages?: WikipediaPage[] }
    }>({
      generator: "categorymembers",
      gcmtitle: `Category:${category}`,
      gcmnamespace: "0",
      gcmlimit: "500",
      prop: "pageimages|pageviews",
      pithumbsize: "900",
      pilimit: "max",
    })
    for (const page of payload.query?.pages ?? []) {
      pages.set(page.pageid, page)
    }
  }
  return [...pages.values()]
}

function cleanWikipediaTitle(title: string) {
  return title.replace(/\s*[（(][^（）()]+[）)]\s*$/u, "").trim()
}

const WIKIPEDIA_NON_ENTITY_TITLE = /(列表|人物|皇帝|年表|世系)$/u

function wikipediaCategorySource(
  options: WikipediaSourceOptions,
): CatalogSource {
  return {
    id: options.id,
    label: options.label,
    description: options.description,
    provider: "中文维基百科 API / Wikimedia Commons",
    sourceUrl: "https://zh.wikipedia.org/",
    defaultLimit: options.defaultLimit,
    async sync(limit) {
      const pages = await wikipediaPages(options.categories)
      return pages
        .map((page) => {
          const displayName = cleanWikipediaTitle(page.title)
          const views = Object.values(page.pageviews ?? {}).reduce<number>(
            (sum, count) => sum + (count ?? 0),
            0,
          )
          return {
            page,
            views,
            item: WIKIPEDIA_NON_ENTITY_TITLE.test(displayName)
              ? null
              : entity({
                  id: `wikipedia-${options.id}-${page.pageid}`,
                  displayName,
                  pack: options.pack,
                  category: options.category,
                  imageUrl: page.thumbnail?.source ?? "",
                  source: `中文维基百科 #${page.pageid}`,
                  popularity: 35 + Math.log10(views + 1) * 12,
                }),
          }
        })
        .filter(
          (
            result,
          ): result is typeof result & {
            item: Entity
          } => result.item !== null,
        )
        .sort((left, right) => right.views - left.views)
        .slice(0, limit)
        .map((result) => result.item)
    },
  }
}

type NetEaseArtist = {
  id: number
  name: string
  picUrl?: string
  img1v1Url?: string
}

const NETEASE_HEADERS = {
  accept: "application/json,text/html",
  referer: "https://music.163.com/",
  "user-agent": "Mozilla/5.0 homophone-meme/0.1",
}

function secureImageUrl(value = "") {
  return value.replace(/^http:/u, "https:")
}

function neteaseArtistEntity(
  artist: NetEaseArtist,
  category: string,
  popularity: number,
) {
  return entity({
    id: `netease-${artist.id}`,
    displayName: normalizeHanName(artist.name) || artist.name,
    pack: "流行音乐",
    category,
    imageUrl: secureImageUrl(artist.picUrl || artist.img1v1Url),
    source: `网易云音乐 #${artist.id}`,
    popularity,
  })
}

async function fetchNeteaseArtist(id: number) {
  const response = await fetch(`https://music.163.com/api/artist/${id}`, {
    headers: NETEASE_HEADERS,
  })
  if (!response.ok) {
    throw new Error(`NETEASE_ARTIST_FAILED_${response.status}`)
  }
  const payload = (await response.json()) as {
    code?: number
    artist?: NetEaseArtist
  }
  return payload.code === 200 ? payload.artist ?? null : null
}

const neteaseMusicianSource: CatalogSource = {
  id: "netease-musicians",
  label: "热门歌手与音乐人",
  description: "网易云音乐热门榜中的华语歌手与创作人",
  provider: "网易云音乐公开页面",
  sourceUrl: "https://music.163.com/discover/artist/",
  defaultLimit: 200,
  async sync(limit) {
    const response = await fetch(
      `https://music.163.com/api/artist/top?offset=0&limit=${limit}`,
      { headers: NETEASE_HEADERS },
    )
    if (!response.ok) {
      throw new Error(`NETEASE_MUSICIAN_SYNC_FAILED_${response.status}`)
    }
    const payload = (await response.json()) as {
      code?: number
      artists?: NetEaseArtist[]
    }
    if (payload.code !== 200) throw new Error("NETEASE_MUSICIAN_SYNC_FAILED")
    return (payload.artists ?? [])
      .map((artist, index) =>
        neteaseArtistEntity(
          artist,
          "歌手音乐人",
          100 - Math.log2(index + 1) * 5,
        ),
      )
      .filter((item): item is Entity => item !== null)
      .slice(0, limit)
  },
}

const neteaseGroupSource: CatalogSource = {
  id: "netease-groups",
  label: "热门乐队与组合",
  description: "网易云音乐华语组合与乐队热门列表",
  provider: "网易云音乐公开页面",
  sourceUrl: "https://music.163.com/discover/artist/cat?id=1003",
  defaultLimit: 40,
  async sync(limit) {
    const response = await fetch(
      "https://music.163.com/discover/artist/cat?id=1003&initial=-1",
      { headers: NETEASE_HEADERS },
    )
    if (!response.ok) {
      throw new Error(`NETEASE_GROUP_SYNC_FAILED_${response.status}`)
    }
    const html = await response.text()
    const artists = new Map<number, string>()
    const pattern =
      /href="\s*\/artist\?id=(\d+)"[^>]*class="nm[^"]*"[^>]*>([^<]+)<\/a>/gu
    for (const match of html.matchAll(pattern)) {
      artists.set(Number(match[1]), match[2].replace(/&amp;/gu, "&").trim())
    }
    const candidates = [...artists.entries()].slice(
      0,
      Math.min(50, Math.max(limit * 2, limit)),
    ).filter(([, name]) => !["群星", "儿歌多多", "贝瓦儿歌"].includes(name))
    const details: NetEaseArtist[] = []
    for (let offset = 0; offset < candidates.length; offset += 5) {
      const batch = await Promise.all(
        candidates.slice(offset, offset + 5).map(async ([id, name]) => {
          return (await fetchNeteaseArtist(id)) ?? { id, name }
        }),
      )
      details.push(...batch)
    }
    return details
      .map((artist, index) =>
        neteaseArtistEntity(
          artist,
          "乐队组合",
          95 - Math.log2(index + 1) * 5,
        ),
      )
      .filter((item): item is Entity => item !== null)
      .slice(0, limit)
  },
}

const pokemonSource: CatalogSource = {
  id: "pokemon",
  label: "宝可梦",
  description: "简体中文名称 + PokeAPI 官方立绘",
  provider: "pokemon 数据包 / PokeAPI",
  sourceUrl: "https://pokeapi.co/",
  defaultLimit: 500,
  async sync(limit) {
    return pokemon
      .all("zh-Hans")
      .slice(0, limit)
      .map((displayName, index) =>
        entity({
          id: `pokemon-${index + 1}`,
          displayName,
          pack: "宝可梦",
          category: "游戏角色",
          imageUrl:
            "https://raw.githubusercontent.com/PokeAPI/sprites/master/" +
            `sprites/pokemon/other/official-artwork/${index + 1}.png`,
          source: `PokeAPI #${index + 1}`,
          popularity: 100 - Math.log2(index + 1) * 5,
        }),
      )
      .filter((item): item is Entity => item !== null)
  },
}

type RiotChampion = {
  id: string
  name: string
  title: string
}

const riotSource: CatalogSource = {
  id: "riot",
  label: "英雄联盟",
  description: "Data Dragon 简体中文英雄与官方原画",
  provider: "Riot Data Dragon",
  sourceUrl: "https://developer.riotgames.com/docs/lol#data-dragon",
  defaultLimit: 200,
  async sync(limit) {
    const versions = (await (
      await fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    ).json()) as string[]
    const version = versions[0]
    if (!version) throw new Error("RIOT_VERSION_UNAVAILABLE")
    const response = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/champion.json`,
    )
    if (!response.ok) throw new Error(`RIOT_SYNC_FAILED_${response.status}`)
    const payload = (await response.json()) as {
      data?: Record<string, RiotChampion>
    }
    return Object.values(payload.data ?? {})
      .slice(0, limit)
      .map((champion) =>
        entity({
          id: `riot-${champion.id.toLowerCase()}`,
          displayName: champion.title,
          aliases: [champion.name],
          pack: "英雄联盟",
          category: "游戏角色",
          imageUrl:
            "https://ddragon.leagueoflegends.com/cdn/img/champion/" +
            `splash/${champion.id}_0.jpg`,
          source: `Riot Data Dragon ${version}`,
          popularity: 75,
        }),
      )
      .filter((item): item is Entity => item !== null)
  },
}

type GenshinWord = {
  id: string
  en?: string
  zhCN?: string
  tags?: string[]
}

const genshinSource: CatalogSource = {
  id: "genshin",
  label: "原神",
  description: "中文角色名与角色立绘",
  provider: "Genshin Dictionary / genshin.dev",
  sourceUrl: "https://genshin-dictionary.com/",
  defaultLimit: 100,
  async sync(limit) {
    const [wordsResponse, idsResponse] = await Promise.all([
      fetch("https://dataset.genshin-dictionary.com/words.json"),
      fetch("https://genshin.jmp.blue/characters"),
    ])
    if (!wordsResponse.ok || !idsResponse.ok) {
      throw new Error(
        `GENSHIN_SYNC_FAILED_${wordsResponse.status}_${idsResponse.status}`,
      )
    }
    const words = (await wordsResponse.json()) as GenshinWord[]
    const availableIds = new Set((await idsResponse.json()) as string[])
    const seen = new Set<string>()

    return words
      .map((word) => {
        if (
          !word.tags?.includes("character-main") ||
          !word.zhCN ||
          seen.size >= limit
        ) {
          return null
        }
        const characterId = [word.id, latinSlug(word.en ?? "")].find((id) =>
          availableIds.has(id),
        )
        if (!characterId || seen.has(characterId)) return null
        const result = entity({
          id: `genshin-${characterId}`,
          displayName: word.zhCN,
          pack: "原神",
          category: "游戏角色",
          imageUrl: `https://genshin.jmp.blue/characters/${characterId}/card`,
          source: `Genshin Dictionary · ${characterId}`,
          popularity: 82,
        })
        if (result) seen.add(characterId)
        return result
      })
      .filter((item): item is Entity => item !== null)
  },
}

type StarRailCharacter = {
  id: string
  name: string
  rarity: number
  portrait: string
}

const starRailSource: CatalogSource = {
  id: "starrail",
  label: "崩坏：星穹铁道",
  description: "中文角色名与角色立绘",
  provider: "StarRailStaticAPI",
  sourceUrl: "https://github.com/VizualAbstract/StarRailStaticAPI",
  defaultLimit: 100,
  async sync(limit) {
    const response = await fetch(
      "https://vizualabstract.github.io/StarRailStaticAPI/db/cn/characters.json",
    )
    if (!response.ok) {
      throw new Error(`STARRAIL_SYNC_FAILED_${response.status}`)
    }
    const payload = (await response.json()) as Record<
      string,
      StarRailCharacter
    >
    return Object.values(payload)
      .slice(0, limit)
      .map((character) =>
        entity({
          id: `starrail-${character.id}`,
          displayName: character.name,
          pack: "崩坏：星穹铁道",
          category: "游戏角色",
          imageUrl:
            "https://vizualabstract.github.io/StarRailStaticAPI/assets/" +
            character.portrait,
          source: `StarRailStaticAPI #${character.id}`,
          popularity: character.rarity >= 5 ? 82 : 72,
        }),
      )
      .filter((item): item is Entity => item !== null)
  },
}

type BangumiSubject = {
  id: number
  name: string
  name_cn?: string
  images?: {
    large?: string
  }
  collection?: {
    collect?: number
  }
}

const bangumiSource: CatalogSource = {
  id: "bangumi",
  label: "Bangumi 热门动漫",
  description: "热门动漫中文名与封面",
  provider: "Bangumi API",
  sourceUrl: "https://github.com/bangumi/api",
  defaultLimit: 200,
  async sync(limit) {
    const subjects: BangumiSubject[] = []
    const pageSize = 20
    for (let page = 1; page <= Math.ceil(limit / pageSize); page += 1) {
      const response = await fetch(
        `https://api.bgm.tv/v0/search/subjects?limit=${pageSize}&offset=${(page - 1) * pageSize}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "homophone-meme/0.1",
          },
          body: JSON.stringify({
            keyword: "",
            sort: "heat",
            filter: { type: [2], nsfw: false },
          }),
        },
      )
      if (!response.ok) {
        throw new Error(`BANGUMI_SYNC_FAILED_${response.status}`)
      }
      const payload = (await response.json()) as {
        data?: BangumiSubject[]
      }
      subjects.push(...(payload.data ?? []))
    }

    return subjects
      .slice(0, limit)
      .map((subject) => {
        const displayName = subject.name_cn?.trim() || subject.name
        return entity({
          id: `bangumi-${subject.id}`,
          displayName,
          aliases: [subject.name],
          pack: "热门动漫",
          category: "动漫作品",
          imageUrl: subject.images?.large ?? "",
          source: `Bangumi #${subject.id}`,
          popularity:
            35 + Math.log10((subject.collection?.collect ?? 0) + 1) * 14,
        })
      })
      .filter((item): item is Entity => item !== null)
  },
}

const historySource = wikipediaCategorySource({
  id: "wikipedia-history",
  label: "历史人物",
  description: "按近期关注度收录有肖像的中国历史人物",
  pack: "历史人物",
  category: "历史人物",
  categories: [
    "中国上古人物",
    "中国皇帝",
    "中国思想家",
    "中国军事人物",
    "汉朝人",
    "三国人",
    "隋朝人",
    "唐朝人",
    "唐朝詩人",
    "宋朝人",
    "宋朝詞人",
    "元朝人",
    "明朝人",
    "清朝人",
  ],
  defaultLimit: 150,
})

const celebritySource = wikipediaCategorySource({
  id: "wikipedia-celebrities",
  label: "流行明星",
  description: "按近期关注度收录两岸三地演员与艺人",
  pack: "流行明星",
  category: "演员艺人",
  categories: [
    "中国男演员",
    "中国女演员",
    "香港男演員",
    "香港女演員",
    "台灣男演員",
    "台灣女演員",
    "中国电影男演员",
    "中国电影女演员",
    "香港電影男演員",
    "香港電影女演員",
    "台灣電影男演員",
    "台灣電影女演員",
  ],
  defaultLimit: 200,
})

export const defaultCatalogSources: Record<CatalogSourceId, CatalogSource> = {
  pokemon: pokemonSource,
  riot: riotSource,
  genshin: genshinSource,
  starrail: starRailSource,
  bangumi: bangumiSource,
  "wikipedia-history": historySource,
  "wikipedia-celebrities": celebritySource,
  "netease-musicians": neteaseMusicianSource,
  "netease-groups": neteaseGroupSource,
}

export function listCatalogSources(sources = defaultCatalogSources) {
  return Object.values(sources).map(
    ({ id, label, description, provider, sourceUrl, defaultLimit }) => ({
      id,
      label,
      description,
      provider,
      sourceUrl,
      defaultLimit,
    }),
  )
}
