## 首页

[谷歌](https://www.google.com.hk/)    [新浪](http://www.sina.com.cn/)   [微博](https://weibo.com/u/1376260467)    [凤凰网](http://www.ifeng.com/)

## 命名管道通信：服务端

服务端的进程首先创建命名管道。创建命名管道时必须制定本地的命名管道名称和最大允许的实例数（因为Windows允许一个名称对应多个命名管道实例）。服务器使用函数CreateNamedPipe创建命名管道并成功返回一个命名管道的句柄。然后，服务器可以使用ConnectNamedPipe函数等待客户端的连接。ConnectNamedPipe 支持同步或异步模式。
处理完成后，服务端可以调用DisconnectNamedPipe来断开连接从而可以连接下一个客户端进程。或者调用CloseHandle关闭命名管道实例

## 命名管道通信：服务端

客户端调用CreateFile连接一个正在等待的命名管道实例，此时客户端需要指定命名管道的名称。CreateFile成功返回后，客户端会得到一个指向已经建立的命名管道的句柄，此时服务器的ConnectNamedPipe也建立完成或WaitNamedPipe测试命名管道实例是否可用。使用完成之后，客户端可以调用CloseHandle关闭一个已经连接的命名管道实例。

## 服务器创建命名管道函数

创建命名管道的函数为CreateNamedPipe，声明如下：

    HANDLE  WINAPI   CreateNamedPipe(
      _In_     LPCTSTR               lpName,                //管道名称字符串，格式必须为 \\.\pipe\pipeName
      _In_     DWORD                 dwOpenMode,            //打开方式：单/双向、直通（同步）/重叠（异步）、安全访问方式
      _In_     DWORD                 dwPipeMode,            //管道类型：字节/消息
      _In_     DWORD                 nMaxInstances,         //最大实例数
      _In_     DWORD                 nOutBufferSize,        //输出缓存大小
      _In_     DWORD                 nInBufferSize,         //输入缓存大小
      _In_     DWORD                 nDefaultTimeOut,       //超时时间，0使用默认值
      _In_opt_ LPSECURITY_ATTRIBUTES lpSecurityAttributes   //安全特性，设为0使用默认
    );
    //返回值：命名管道实例的句柄

## 服务器等待客户端连接

等待客户端连接时调用ConnectNamedPipe 函数，声明如下：

    BOOL WINAPI ConnectNamedPipe(
        _In_        HANDLE       hNamedPipe,        //创建的命名管道的句柄
        _Inout_opt_ LPOVERLAPPED lpOverlapped       // OVERLAPPED 对象的指针,包含一个事件的句柄
    );
    //返回值：函数执行结果，非0成功/0失败，通过GetLastError返回错误码

## 客户端连接命名管道

客户端连接命名管道调用函数 WaitNamedPipe 函数，声明如下：

    BOOL WINAPI WaitNamedPipe(
        _In_ LPCTSTR lpNamedPipeName,       //命名管道的名称
         _In_ DWORD   nTimeOut              //超时时间，可选择默认或始终
    );
    //返回值
    
