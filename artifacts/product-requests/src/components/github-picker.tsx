import { useState } from "react";
import {
  useListGithubRepos,
  getListGithubReposQueryKey,
  useListGithubBranches,
  getListGithubBranchesQueryKey,
  useListGithubPulls,
  getListGithubPullsQueryKey,
} from "@workspace/api-client-react";
import type {
  GithubRepo,
  GithubBranch,
  GithubPull,
} from "@workspace/api-client-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Loader2, X } from "lucide-react";

function PickerShell({
  value,
  placeholder,
  onClear,
  children,
  disabled,
}: {
  value: string | null;
  placeholder: string;
  onClear?: () => void;
  children: (close: () => void) => React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="mt-1 h-8 w-full justify-between text-sm font-normal"
        >
          <span
            className={`truncate ${value ? "text-foreground" : "text-muted-foreground/70"}`}
          >
            {value || placeholder}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {value && onClear && !disabled && (
              <X
                className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-foreground/85"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClear();
                }}
              />
            )}
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground/70" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export function RepoPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (repo: GithubRepo | null) => void;
}) {
  const [q, setQ] = useState("");
  const params = { q: q || undefined };
  const { data, isLoading, error } = useListGithubRepos(params, {
    query: {
      staleTime: 60_000,
      queryKey: getListGithubReposQueryKey(params),
    },
  });

  return (
    <PickerShell
      value={value}
      placeholder="Select repository…"
      onClear={() => onChange(null)}
    >
      {(close) => (
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search repos…"
            value={q}
            onValueChange={setQ}
          />
          <CommandList>
            {isLoading && (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/70" />
              </div>
            )}
            {error && (
              <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400">
                Could not load repos. Is GitHub connected?
              </div>
            )}
            {!isLoading && !error && (
              <>
                <CommandEmpty>No repos found.</CommandEmpty>
                <CommandGroup>
                  {(data ?? []).map((r) => (
                    <CommandItem
                      key={r.fullName}
                      value={r.fullName}
                      onSelect={() => {
                        onChange(r);
                        close();
                      }}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="font-medium truncate">
                          {r.fullName}
                        </span>
                        {r.private && (
                          <span className="text-[10px] uppercase text-muted-foreground border border-input rounded px-1">
                            private
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <span className="text-xs text-muted-foreground truncate w-full">
                          {r.description}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      )}
    </PickerShell>
  );
}

export function BranchPicker({
  repo,
  value,
  onChange,
}: {
  repo: string | null;
  value: string | null;
  onChange: (branch: GithubBranch | null) => void;
}) {
  const [q, setQ] = useState("");
  const enabled = !!repo;
  const params = { repo: repo ?? "", q: q || undefined };
  const { data, isLoading, error } = useListGithubBranches(params, {
    query: {
      enabled,
      staleTime: 30_000,
      queryKey: getListGithubBranchesQueryKey(params),
    },
  });

  return (
    <PickerShell
      value={value}
      placeholder={repo ? "Select branch…" : "Pick a repo first"}
      onClear={() => onChange(null)}
      disabled={!enabled}
    >
      {(close) => (
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search branches…"
            value={q}
            onValueChange={setQ}
          />
          <CommandList>
            {isLoading && (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/70" />
              </div>
            )}
            {error && (
              <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400">
                Could not load branches.
              </div>
            )}
            {!isLoading && !error && (
              <>
                <CommandEmpty>No branches found.</CommandEmpty>
                <CommandGroup>
                  {(data ?? []).map((b) => (
                    <CommandItem
                      key={b.name}
                      value={b.name}
                      onSelect={() => {
                        onChange(b);
                        close();
                      }}
                    >
                      <span className="font-medium truncate">{b.name}</span>
                      {b.protected && (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground border border-input rounded px-1">
                          protected
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      )}
    </PickerShell>
  );
}

export function PullPicker({
  repo,
  value,
  onChange,
}: {
  repo: string | null;
  value: string | null;
  onChange: (pull: GithubPull | null) => void;
}) {
  const [q, setQ] = useState("");
  const enabled = !!repo;
  const params = { repo: repo ?? "", q: q || undefined };
  const { data, isLoading, error } = useListGithubPulls(params, {
    query: {
      enabled,
      staleTime: 30_000,
      queryKey: getListGithubPullsQueryKey(params),
    },
  });

  return (
    <PickerShell
      value={value}
      placeholder={repo ? "Link a pull request…" : "Pick a repo first"}
      onClear={() => onChange(null)}
      disabled={!enabled}
    >
      {(close) => (
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by title, #number, or branch…"
            value={q}
            onValueChange={setQ}
          />
          <CommandList>
            {isLoading && (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/70" />
              </div>
            )}
            {error && (
              <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400">
                Could not load pull requests.
              </div>
            )}
            {!isLoading && !error && (
              <>
                <CommandEmpty>No pull requests found.</CommandEmpty>
                <CommandGroup>
                  {(data ?? []).map((p) => {
                    const state = p.merged ? "merged" : p.state;
                    const tint =
                      state === "merged"
                        ? "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300"
                        : state === "closed"
                          ? "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300"
                          : "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300";
                    return (
                      <CommandItem
                        key={p.number}
                        value={`#${p.number} ${p.title} ${p.headRef}`}
                        onSelect={() => {
                          onChange(p);
                          close();
                        }}
                        className="flex flex-col items-start gap-0.5"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="text-xs font-mono text-muted-foreground">
                            #{p.number}
                          </span>
                          <span className="font-medium truncate flex-1">
                            {p.title}
                          </span>
                          <span
                            className={`text-[10px] uppercase rounded px-1 ${tint}`}
                          >
                            {state}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground truncate w-full">
                          {p.headRef} → {p.baseRef}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      )}
    </PickerShell>
  );
}
