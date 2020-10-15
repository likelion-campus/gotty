import * as bare from "xterm";
import { lib } from "libapps"


bare.loadAddon("fit");

export class Xterm {
    elem: HTMLElement;
    term: bare;
    resizeListener: () => void;
    decoder: lib.UTF8Decoder;

    message: HTMLElement;
    messageTimeout: number;
    messageTimer: number;


    constructor(elem: HTMLElement) {
        this.elem = elem;
        this.term = new bare();

        this.message = elem.ownerDocument.createElement("div");
        this.message.className = "xterm-overlay";
        this.messageTimeout = 2000;

        this.resizeListener = () => {
            this.term.fit();
            this.term.scrollToBottom();
            this.showMessage(String(this.term.cols) + "x" + String(this.term.rows), this.messageTimeout);
        };

        this.term.on("open", () => {
            this.resizeListener();
            window.addEventListener("resize", () => { this.resizeListener(); });

            if (!(window.parent instanceof Window)) {
                this.term.viewport.viewportElement.addEventListener(
                  "scroll",
                  function (e) {
                      window.parent.postMessage({
                          type: 'scrollTop', payload: e.target.scrollTop
                      }, '*');
                  }
                );
            }
        });

        this.term.open(elem, true);

        this.decoder = new lib.UTF8Decoder()
    };

    info(): { columns: number, rows: number } {
        return { columns: this.term.cols, rows: this.term.rows };
    };

    output(data: string) {
        const content = this.decoder.decode(data);

        this.term.write(content);

        if (!(window.parent instanceof Window)) {
            // @ts-ignore
            window.parent.postMessage({
                type: 'output', payload: content
            }, '*');
        }
    };

    showMessage(message: string, timeout: number) {
        this.message.textContent = message;
        this.elem.appendChild(this.message);

        if (this.messageTimer) {
            clearTimeout(this.messageTimer);
        }
        if (timeout > 0) {
            this.messageTimer = setTimeout(() => {
                this.elem.removeChild(this.message);
            }, timeout);
        }
    };

    removeMessage(): void {
        if (this.message.parentNode == this.elem) {
            this.elem.removeChild(this.message);
        }
    }

    setWindowTitle(title: string) {
        document.title = title;
    };

    setPreferences(value: object) {
    };

    onInput(callback: (input: string) => void) {
        this.term.on("data", (data) => {
            callback(data);
        });

    };

    onResize(callback: (colmuns: number, rows: number) => void) {
        this.term.on("resize", (data) => {
            callback(data.cols, data.rows);
        });
    };

    deactivate(): void {
        this.term.off("data");
        this.term.off("resize");
        this.term.blur();
    }

    reset(): void {
        this.removeMessage();
        // this.term.clear();

        if (this.term.x != 0) {
            this.term.scroll();
            this.term.x = 0;
        }
        for (let i = this.term.y; i < this.term.rows; i++) {
            this.term.eraseLine(i);
        }

        this.term.refresh(0, this.term.rows - 1);
    }

    close(): void {
        window.removeEventListener("resize", this.resizeListener);
        this.term.destroy();
    }
}
