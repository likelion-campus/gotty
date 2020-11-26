package watcher

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/radovskyb/watcher"
)

var storageToken = os.Getenv("STORAGE_TOKEN")

type Watcher struct {
	_watcher *watcher.Watcher

	listener map[chan []byte]interface{}
	listenerMutex sync.Mutex
}

func New() (*Watcher, error) {
	if len(strings.TrimSpace(storageToken)) == 0 {
		log.Fatalln("environment 'STORAGE_TOKEN' must not be blank")
	}

	cwd, err := os.Getwd()
	if err != nil {
		log.Fatalln(err)
	}

	_watcher := watcher.New()

	watcherWrapper := Watcher{
		_watcher: _watcher,
		listener: make(map[chan []byte]interface{}),
	}

	_watcher.FilterOps(watcher.Create, watcher.Remove, watcher.Rename, watcher.Move, watcher.Write)

	ignoreRegex := strings.Join(
		[]string{
			"/\\.bash_history(?:/|$)",
			"/\\.python_history(?:/|$)",
			"/__pycache__(?:/|$)",
			"/\\.cache(?:/|$)",
			"/sqlite3-journal$",
			"\\.log$",
			"\\.swp$",
			"\\.tmp$"},
		"|")
	ignoreRegex = "(?:" + ignoreRegex + ")"
	ignoreRegexp := regexp.MustCompile(ignoreRegex)
	ignoreFilterHookFunc := func(info os.FileInfo, fullPath string) error {
		if ignoreRegexp.MatchString(fullPath) {
			// Skip ignored file
			return watcher.ErrSkip
		}
		return nil
	}
	_watcher.AddFilterHook(ignoreFilterHookFunc)

	watcherWrapper.start(cwd, time.Millisecond * 1000)
	
	return &watcherWrapper, nil
}

func (wt *Watcher) start(path string, d time.Duration) {
	go func() {
		for {
			select {
			case event := <-wt._watcher.Event:	
				fileType := "file"
				if event.IsDir() {
					fileType = "directory"
				}

				msg := map[string]interface{}{
					"storage": storageToken,
					"file_type": fileType,
					"path": strings.Replace(event.Path, path, "", 1),
					"mtime": fmt.Sprintf("%d.%d", event.ModTime().Unix(), event.ModTime().Nanosecond()),
				}

				if event.Op == watcher.Create {
					msg["action"] = "create"
				} else if event.Op == watcher.Remove {
					msg["action"] = "remove"
				} else if event.Op == watcher.Move || event.Op == watcher.Rename {
					msg["action"] = "rename"
					msg["src_path"] = strings.Replace(event.OldPath, path, "", 1)
					msg["dest_path"] = msg["path"]
					delete(msg, "path")
				} else if event.Op == watcher.Write {
					if event.IsDir() {
						break
					}
					msg["action"] = "modify"
				} else {
					break
				}

				msgBytes, err := json.Marshal(msg)
				if err != nil {
					log.Fatalln(err)
				}

				wt.notify(msgBytes)
			case err := <-wt._watcher.Error:
				log.Fatalln(err)
			case <-wt._watcher.Closed:
				return
			}
		}
	}()

	if err := wt._watcher.AddRecursive(path); err != nil {
		log.Fatalln(err)
	}

	go func() {
		if err := wt._watcher.Start(d); err != nil {
			log.Fatalln(err)
		}
	}()
}

func (wt *Watcher) Close() {
	wt._watcher.Close()
}

func (wt *Watcher) Listen(ch chan []byte) {
	wt.listenerMutex.Lock()
	defer wt.listenerMutex.Unlock()

	wt.listener[ch] = nil // dummy value(nil)
}

func (wt *Watcher) Unlisten(ch chan []byte) {
	wt.listenerMutex.Lock()
	defer wt.listenerMutex.Unlock()

	delete(wt.listener, ch)
}

func (wt *Watcher) notify(msg []byte) {
	wt.listenerMutex.Lock()
	defer wt.listenerMutex.Unlock()

	for listenerChannel := range wt.listener {
		listenerChannel <- msg
	}
}
