from character_runtime.app import Application


def main() -> int:
    app = Application()
    return app.run()


if __name__ == "__main__":
    raise SystemExit(main())

