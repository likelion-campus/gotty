export const protocols = ["webtty"];

export const msgInputUnknown = '0';
export const msgInput = '1';
export const msgPing = '2';
export const msgResizeTerminal = '3';

export const msgUnknownOutput = '0';
export const msgOutput = '1';
export const msgPong = '2';
export const msgSetWindowTitle = '3';
export const msgSetPreferences = '4';
export const msgSetReconnect = '5';
export const msgFsEvent = 'F';


export interface Terminal {
    info(): { columns: number, rows: number };
    output(data: string): void;
    showMessage(message: string, timeout: number): void;
    removeMessage(): void;
    setWindowTitle(title: string): void;
    setPreferences(value: object): void;
    onInput(callback: (input: string) => void): void;
    onResize(callback: (colmuns: number, rows: number) => void): void;
    reset(): void;
    deactivate(): void;
    close(): void;
}

export interface Connection {
    open(): void;
    close(): void;
    send(data: string): void;
    isOpen(): boolean;
    onOpen(callback: () => void): void;
    onReceive(callback: (data: string) => void): void;
    onClose(callback: () => void): void;
}

export interface ConnectionFactory {
    create(): Connection;
}


export class WebTTY {
    term: Terminal;
    connectionFactory: ConnectionFactory;
    args: string;
    authToken: string;
    reconnect: number;

    constructor(term: Terminal, connectionFactory: ConnectionFactory, args: string, authToken: string) {
        this.term = term;
        this.connectionFactory = connectionFactory;
        this.args = args;
        this.authToken = authToken;
        this.reconnect = -1;
    };

    open() {
        let connection = this.connectionFactory.create();
        let pingTimer: number;
        let reconnectTimeout: number;

        const setup = () => {
            connection.onOpen(() => {
                const termInfo = this.term.info();

                connection.send(JSON.stringify(
                    {
                        Arguments: this.args,
                        AuthToken: this.authToken,
                    }
                ));


                const resizeHandler = (colmuns: number, rows: number) => {
                    connection.send(
                        msgResizeTerminal + JSON.stringify(
                            {
                                columns: colmuns,
                                rows: rows
                            }
                        )
                    );
                };

                this.term.onResize(resizeHandler);
                resizeHandler(termInfo.columns, termInfo.rows);

                this.term.onInput(
                    (input: string) => {
                        connection.send(msgInput + input);
                    }
                );

                pingTimer = setInterval(() => {
                    connection.send(msgPing)
                }, 30 * 1000);


                window.addEventListener('message', e => {
                    // TODO: 강의 스튜디오가 현재 프로젝트 중단 상태라 어떤 도메인으로써 넘어오는지 몰라 '.codelion.net'에서 요청왔을 경우만
                    // 이벤트를 처리하도록한다. 후에 강의라이언 도메인이 무엇인지 알게된다면 이 곳을 수정하여야 한다.
                    if (e.origin != null && e.origin.search('\.codelion\.net$') != -1) {
                        connection.send(msgInput + e.data);
                    }
                });

                if (!(window.parent instanceof Window)) {
                    const onPointer = e => {
                        // TODO: 강의 스튜디오가 현재 프로젝트 중단 상태라 어떤 도메인으로써 넘어오는지 몰라 '.codelion.net'에서 요청왔을 경우만
                        // 이벤트를 처리하도록한다. 후에 강의라이언 도메인이 무엇인지 알게된다면 이 곳을 수정하여야 한다.
                        if (e.origin != null && e.origin.search('\.codelion\.net$') != -1) {
                            window.parent.postMessage( {
                                type: e.type, clientX: e.clientX, clientY: e.clientY
                            }, '*' );
                        }
                    };

                    window.addEventListener('pointermove', onPointer);
                    window.addEventListener('pointerdown', onPointer);
                    window.addEventListener('pointerup', onPointer);
                }
            });

            connection.onReceive((data) => {
                const payload = data.slice(1);
                switch (data[0]) {
                    case msgOutput:
                        this.term.output(atob(payload));
                        break;
                    case msgPong:
                        break;
                    case msgSetWindowTitle:
                        this.term.setWindowTitle(payload);
                        break;
                    case msgSetPreferences:
                        const preferences = JSON.parse(payload);
                        this.term.setPreferences(preferences);
                        break;
                    case msgSetReconnect:
                        const autoReconnect = JSON.parse(payload);
                        console.log("Enabling reconnect: " + autoReconnect + " seconds")
                        this.reconnect = autoReconnect;
                        break;
                    case msgFsEvent:
                        const msg = JSON.parse(atob(payload))
                        if (Window == null || !(window.parent instanceof Window)) {
                            // @ts-ignore
                            window.parent.postMessage({
                                type: 'file_sync', message: msg
                            }, '*');
                        }
                }
            });

            connection.onClose(() => {
                clearInterval(pingTimer);
                this.term.deactivate();
                this.term.showMessage("Connection Closed", 0);
                if (this.reconnect > 0) {
                    reconnectTimeout = setTimeout(() => {
                        connection = this.connectionFactory.create();
                        this.term.reset();
                        setup();
                    }, this.reconnect * 1000);
                }
            });

            connection.open();
        }

        setup();
        return () => {
            clearTimeout(reconnectTimeout);
            connection.close();
        }
    };
};
