import { useEffect, useState } from "react";
import { Link } from "react-router";
import { dramaSharing, type SharedDrama } from "@/api/drama/share";
import { Button } from "@/components/ui/button";

export function SharedDramaList({ keyword }: { keyword: string }) {
  const [items, setItems] = useState<SharedDrama[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(false);
    void dramaSharing
      .list(keyword, page)
      .then(
        (data) => {
          if (active) {
            setItems((previous) =>
              page === 1 ? (data.list ?? []) : [...previous, ...(data.list ?? [])],
            );
            setTotal(data.total);
          }
        },
        () => {
          if (active) setError(true);
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [keyword, page, reload]);
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.id}
          to={`/drama/${item.id}/reader`}
          className="border-border hover:bg-chrome-hover grid min-w-0 gap-2 rounded-xl border p-5"
        >
          <strong className="truncate">{item.title}</strong>
          <span className="text-muted-foreground text-sm">仅可查看</span>
        </Link>
      ))}
      <div className="col-span-full flex justify-center py-6 text-sm text-muted-foreground">
        {error ? (
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </Button>
        ) : busy ? (
          "加载中…"
        ) : items.length === 0 ? (
          keyword ? (
            "没有找到匹配的短剧"
          ) : (
            "还没有人与你共享短剧"
          )
        ) : items.length < total ? (
          <Button variant="outline" onClick={() => setPage(page + 1)}>
            加载更多
          </Button>
        ) : null}
      </div>
    </>
  );
}
