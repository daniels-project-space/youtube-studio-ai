/*
 * Convex's standalone binary accepts its instance secret only as an argument.
 * Inject it before libc invokes the dynamically linked program, without putting
 * it in the kernel's command-line buffer. This launcher is qualified only with
 * the pinned backend binary; test again before changing that binary or libc.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef int (*start_fn)(int (*)(int, char **, char **), int, char **,
                        void (*)(void), void (*)(void), void (*)(void), void *);

int __libc_start_main(int (*entry)(int, char **, char **), int argc, char **argv,
                      void (*init)(void), void (*fini)(void),
                      void (*rtld_fini)(void), void *stack_end) {
  const char prefix[] = "YTA_CONVEX_INSTANCE_SECRET=";
  char **env = argv + argc + 1;
  const char *secret = NULL;
  size_t count = 0;
  while (env[count]) {
    if (strncmp(env[count], prefix, sizeof(prefix) - 1) == 0)
      secret = env[count] + sizeof(prefix) - 1;
    count++;
  }
  if (!secret || strlen(secret) != 64 || strspn(secret, "0123456789abcdef") != 64)
    _exit(127);
  char **args = calloc((size_t)argc + count + 4, sizeof(*args));
  if (!args) _exit(127);
  for (int i = 0; i < argc; i++) args[i] = argv[i];
  args[argc] = "--instance-secret";
  args[argc + 1] = (char *)secret;
  size_t written = (size_t)argc + 3;
  for (size_t i = 0; i < count; i++) {
    if (strncmp(env[i], prefix, sizeof(prefix) - 1) != 0 &&
        strncmp(env[i], "LD_PRELOAD=", 11) != 0)
      args[written++] = env[i];
  }
  start_fn original = (start_fn)dlsym(RTLD_NEXT, "__libc_start_main");
  if (!original) _exit(127);
  return original(entry, argc + 2, args, init, fini, rtld_fini, stack_end);
}
