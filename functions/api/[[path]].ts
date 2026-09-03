type RequestContext = {
  request: Request
  env: {
    API_ORIGIN?: string
  }
}

export const onRequest = async ({
  request,
  env,
}: RequestContext): Promise<Response> => {
  if (!env.API_ORIGIN) {
    return Response.json(
      {
        data: null,
        error: {
          code: "API_ORIGIN_NOT_CONFIGURED",
          message: "服务尚未配置。",
          retryable: false,
        },
        requestId: crypto.randomUUID(),
      },
      { status: 503 },
    )
  }
  const incomingUrl = new URL(request.url)
  const upstreamUrl = new URL(
    incomingUrl.pathname.replace(/^\/api(?=\/|$)/u, "") || "/",
    env.API_ORIGIN,
  )
  upstreamUrl.search = incomingUrl.search

  try {
    return await fetch(new Request(upstreamUrl, request))
  } catch (error) {
    console.error(
      "API proxy request failed",
      error instanceof Error ? error.message : String(error),
    )
    return Response.json(
      {
        data: null,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "服务暂时不可用，请稍后再试。",
          retryable: true,
        },
        requestId: crypto.randomUUID(),
      },
      { status: 502 },
    )
  }
}
