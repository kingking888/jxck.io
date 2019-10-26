# File に関する情報の抽象
class Article
  attr_reader :path, :article

  def initialize(path)
    @path = path
    @text = File.read(path)
  end

  # "./blog.jxck.io/entries/2016-01-27"
  def dir
    File.dirname(@path)
  end

  # "new-blog-start"
  def name
    File.basename(@path, ".*")
  end

  # "blog.jxck.io"
  def host
    dir.split("/")[1]
  end

  # "entries/2016-01-27"
  def baseurl
    dir.split("/")[2..4].join("/").to_s
  end

  # "entries/2016-01-27/new-blog-start.html"
  def relative
    "#{baseurl}/#{name}.html"
  end

  # "/entries/2016-01-27/new-blog-start.html"
  def url
    "/#{baseurl}/#{name}.html"
  end

  # "https://blog.jxck.io/entries/2016-01-27/new-blog-start.html"
  def canonical
    "https://#{host}#{url}"
  end

  def title
    hsc @text.match(/^# \[.*\] (.*)/)[1]
  end

  def tags
    @text.split("\n")[0].scan(/\[(.+?)\]/).flatten
  end

  # AST parse する markdown の body
  # 前処理が必要な場合は継承する
  def body
    @text
  end

  def theme
    @text.match(/## (Intro|Theme)(([\n\r]|.)*?)##/m)[2]
  end

  def description
    unlink theme
  end

  def build(markup) # Markup/AMP
    # setting self url
    markup.url = url
    markup.baseurl = baseurl

    # parse ast
    ast = AST.new(body)
    # DEBUG: pp ast.ast

    # traverse
    traverser = Traverser.new(markup)
    article   = traverser.traverse(ast.ast)

    # indent を無視するため
    # ここで pre に code を戻す
    traverser.codes.each {|key, value|
      # markup のもつロジックでコードを処理
      code = markup.code_format(value)
      # hash に差し替えられているところを置き換える
      article.gsub!("// #{key}") { code }
    }

    @article = article
  end

  def target_path
    "#{dir}/#{name}.html"
  end

  def to_s
    path
  end

  def <=>(other)
    path <=> other.path
  end

  protected

  # remove markdown link notation
  # [aaa](http://example.com) -> aaa
  # <http://example.com> -> http://example.com
  def unlink(str)
    str.gsub(/\[(.*?)\]\(.*?\)/, '\1').gsub(/<(http.*?)>/, '\1')
  end
end
