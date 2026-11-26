import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { dramaSharing, type SharedView } from "@/api/drama/share";
import { Button } from "@/components/ui/button";

function SharedMedia({
  drama,
  asset,
  image = false,
  label,
}: {
  drama: string;
  asset: string;
  image?: boolean;
  label: string;
}) {
  const [load, setLoad] = useState(false);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    let objectUrl = "";
    void dramaSharing.media(drama, asset, controller.signal).then(
      (blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setLoad(false);
        }
      },
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [drama, asset, load]);
  if (!url)
    return (
      <Button
        variant="outline"
        disabled={load}
        onClick={() => {
          setFailed(false);
          setLoad(true);
        }}
      >
        {load ? "加载中…" : failed ? `重试 · ${label}` : label}
      </Button>
    );
  return image ? (
    <img className="max-h-96 rounded-lg object-contain" src={url} alt={label} />
  ) : (
    <video className="max-h-96 max-w-full rounded-lg" controls src={url} aria-label={label} />
  );
}

export default function SharedReader() {
  const { id = "" } = useParams();
  return <ReaderContent key={id} id={id} />;
}

function ReaderContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const [view, setView] = useState<SharedView | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void dramaSharing.read(id).then(
        (result) => {
          if (active) {
            setView(result);
            setFailed(false);
          }
        },
        () => {
          if (active) {
            setFailed(true);
            setView(null);
          }
        },
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [id, reload]);
  const episode = view?.episodes[selected] ?? view?.episodes[0];
  const back = "/canvases?scope=shared-drama";
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-5 p-5 pb-20 md:p-10">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Link to={back}>← 共享给我</Link>
        {view && (
          <Button
            variant="ghost"
            disabled={exiting}
            onClick={() => {
              setExiting(true);
              void dramaSharing.remove(id, "me").then(
                () => navigate(back, { replace: true }),
                () => setExiting(false),
              );
            }}
          >
            退出共享
          </Button>
        )}
      </header>
      {!view ? (
        <div>
          {failed ? (
            <>
              <p>无法打开这部共享短剧，请检查查看权限。</p>
              <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
                重试
              </Button>
            </>
          ) : (
            "正在打开短剧…"
          )}
        </div>
      ) : (
        <>
          <div>
            <span className="text-muted-foreground text-sm">仅可查看</span>
            <h1 className="text-3xl font-semibold">{view.title}</h1>
          </div>
          {[
            ["故事大纲", view.outline],
            ["人物设定", view.characters],
          ].map(
            ([title, text]) =>
              text && (
                <details key={title} className="border-border rounded-lg border p-4">
                  <summary>{title}</summary>
                  <p className="mt-3 whitespace-pre-wrap">{text}</p>
                </details>
              ),
          )}
          {episode ? (
            <>
              <label className="grid gap-2">
                选择分集
                <select
                  className="border-border rounded-md border p-2"
                  value={episode.no}
                  onChange={(event) =>
                    setSelected(
                      view.episodes.findIndex((item) => item.no === Number(event.target.value)),
                    )
                  }
                >
                  {view.episodes.map((item) => (
                    <option key={item.no} value={item.no}>
                      第 {item.no} 集 · {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <article key={episode.no} className="grid gap-5">
                <h2 className="text-xl font-medium">{episode.title}</h2>
                <p className="whitespace-pre-wrap">{episode.script || "本集暂无剧本正文"}</p>
                {episode.final && <SharedMedia drama={id} asset={episode.final} label="播放成片" />}
                {episode.segments.map((seg, index) => (
                  <section key={index} className="border-border grid gap-3 rounded-lg border p-4">
                    <h3>分镜 {index + 1}</h3>
                    <p className="whitespace-pre-wrap">{seg.prompt}</p>
                    {seg.board && (
                      <SharedMedia
                        key={seg.board}
                        drama={id}
                        asset={seg.board}
                        image
                        label="查看故事板"
                      />
                    )}
                    {seg.videos.map((asset, i) => (
                      <SharedMedia
                        key={`${asset}-${i}`}
                        drama={id}
                        asset={asset}
                        label={`播放版本 ${i + 1}${asset === seg.selected ? " · 已采用" : ""}`}
                      />
                    ))}
                  </section>
                ))}
              </article>
            </>
          ) : (
            <p>该短剧还没有分集。</p>
          )}
        </>
      )}
    </main>
  );
}
