interface Env {
  WORKER: Fetcher;
}

export const onRequest: PagesFunction<Env> = (ctx) => {
  return ctx.env.WORKER.fetch(ctx.request);
};
