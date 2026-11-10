#include <errno.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;

/* Run the bundled interpreter with its relocated stdlib and without touching the signed bundle. */
int main(int argc, char **argv) {
    uint32_t length = 0;
    _NSGetExecutablePath(NULL, &length);
    char *image = malloc(length);
    if (!image || _NSGetExecutablePath(image, &length) != 0) return 126;
    char *launcher = realpath(image, NULL);
    free(image);
    if (!launcher) return 126;

    char *contents = strdup(launcher);
    if (!contents) return 126;
    for (int i = 0; i < 2; i++) {
        char *slash = strrchr(contents, '/');
        if (!slash) return 126;
        *slash = '\0';
    }
    char *python = NULL, *home = NULL, *executable = NULL;
    if (asprintf(&python, "%s/Helpers/python3.12", contents) < 0 ||
        asprintf(&home, "PYTHONHOME=%s/Resources/Python", contents) < 0 ||
        asprintf(&executable, "PYTHONEXECUTABLE=%s", launcher) < 0) return 126;

    size_t inherited = 0, count = 0;
    while (environ[inherited]) inherited++;
    char **env = calloc(inherited + 5, sizeof(*env));
    char **args = calloc((size_t)argc + 3, sizeof(*args));
    if (!env || !args) return 126;
    for (size_t i = 0; i < inherited; i++) {
        if (strncmp(environ[i], "PYTHON", 6) != 0 &&
            strncmp(environ[i], "__PYVENV_LAUNCHER__=", strlen("__PYVENV_LAUNCHER__=")) != 0)
            env[count++] = environ[i];
    }
    env[count++] = home;
    env[count++] = executable;
    env[count++] = "PYTHONDONTWRITEBYTECODE=1";
    env[count++] = "PYTHONNOUSERSITE=1";
    args[0] = launcher;
    args[1] = "-B";
    args[2] = "-s";
    for (int i = 1; i < argc; i++) args[i + 2] = argv[i];
    execve(python, args, env);
    fprintf(stderr, "Could not start the bundled Python interpreter: %s\n", strerror(errno));
    return 126;
}
